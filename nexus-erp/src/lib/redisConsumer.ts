import Redis from 'ioredis'
import { db } from '@/db/client'

const STREAM_KEY = 'nexus:workflow:events'
const GROUP = 'nexus-erp'
const CONSUMER = 'erp-worker'

type WorkflowEvent = { type: string; instanceId?: string; restartedFromId?: string }

// The workflow engine tags every stream entry with the tenant that produced it. The ERP is
// one tenant among many, so it only acts on its own events.
const TENANT_ID = process.env.WORKFLOW_TENANT_ID ?? 'nexus-erp'

/**
 * Reads the event out of a stream entry's fields. Returns null when the entry has no data or
 * belongs to another tenant. Entries without a tenantId (written before events were tagged)
 * are accepted. Throws if the data is not valid JSON.
 */
export function parseStreamEntry(fields: string[], tenantId: string): WorkflowEvent | null {
  const tenantIdx = fields.indexOf('tenantId')
  if (tenantIdx !== -1 && fields[tenantIdx + 1] !== tenantId) return null

  const dataIdx = fields.indexOf('data')
  if (dataIdx === -1) return null
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return JSON.parse(fields[dataIdx + 1]!) as WorkflowEvent
}

async function ensureGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, GROUP, '0', 'MKSTREAM')
  } catch (err: unknown) {
    // Group already exists — not an error
    if (err instanceof Error && !err.message.includes('BUSYGROUP')) throw err
  }
}

async function handleEvent(event: WorkflowEvent): Promise<void> {
  if (event.type === 'ProcessInstanceTerminated' && event.instanceId) {
    await db.employeeProfileUpdateRequest.updateMany({
      where: { workflowInstanceId: event.instanceId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
  }

  if (event.type === 'ProcessInstanceRestarted' && event.instanceId && event.restartedFromId) {
    await db.employeeProfileUpdateRequest.updateMany({
      where: { workflowInstanceId: event.restartedFromId },
      data: { workflowInstanceId: event.instanceId, status: 'PENDING' },
    })
  }
}

async function processPending(redis: Redis): Promise<void> {
  const results = await redis.xreadgroup(
    'GROUP', GROUP, CONSUMER,
    'COUNT', '100',
    'STREAMS', STREAM_KEY, '0',
  ) as [string, [string, string[]][]][] | null

  if (!results) return

  for (const [, entries] of results) {
    for (const [id, fields] of entries) {
      try {
        const event = parseStreamEntry(fields, TENANT_ID)
        if (event) await handleEvent(event)
      } catch (err) {
        console.error('[redisConsumer] failed to process pending event:', err)
      }
      await redis.xack(STREAM_KEY, GROUP, id)
    }
  }
}

export async function startRedisConsumer(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl)

  await ensureGroup(redis)
  await processPending(redis) // re-process any unacknowledged messages from before restart

  console.log('[redisConsumer] listening on stream', STREAM_KEY)

  void (async () => {
    while (true) {
      try {
        const results = await redis.xreadgroup(
          'GROUP', GROUP, CONSUMER,
          'COUNT', '10',
          'BLOCK', '5000',
          'STREAMS', STREAM_KEY, '>',
        ) as [string, [string, string[]][]][] | null

        if (!results) continue

        for (const [, entries] of results) {
          for (const [id, fields] of entries) {
            try {
              const event = parseStreamEntry(fields, TENANT_ID)
              if (event) await handleEvent(event)
            } catch (err) {
              console.error('[redisConsumer] failed to handle event:', err)
            }
            await redis.xack(STREAM_KEY, GROUP, id)
          }
        }
      } catch (err) {
        console.error('[redisConsumer] read error, retrying in 2s:', err)
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  })()
}
