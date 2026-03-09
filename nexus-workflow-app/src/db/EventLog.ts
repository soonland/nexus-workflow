import postgres from 'postgres'
import type { ExecutionEvent } from 'nexus-workflow-core'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoredExecutionEvent {
  id: string
  instanceId: string | null
  type: string
  occurredAt: Date
  data: ExecutionEvent
}

export interface EventLog {
  append(event: ExecutionEvent): Promise<void>
  getForInstance(instanceId: string): Promise<StoredExecutionEvent[]>
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function extractInstanceId(event: ExecutionEvent): string | null {
  if ('instanceId' in event) return event.instanceId
  return null
}

// ─── InMemoryEventLog ─────────────────────────────────────────────────────────

export class InMemoryEventLog implements EventLog {
  private events: StoredExecutionEvent[] = []

  async append(event: ExecutionEvent): Promise<void> {
    this.events.push({
      id: crypto.randomUUID(),
      instanceId: extractInstanceId(event),
      type: event.type,
      occurredAt: new Date(),
      data: event,
    })
  }

  async getForInstance(instanceId: string): Promise<StoredExecutionEvent[]> {
    return this.events.filter(e => e.instanceId === instanceId)
  }
}

// ─── PostgresEventLog ─────────────────────────────────────────────────────────

export class PostgresEventLog implements EventLog {
  private sql: postgres.Sql

  constructor(connectionString: string) {
    this.sql = postgres(connectionString)
  }

  async append(event: ExecutionEvent): Promise<void> {
    const id = crypto.randomUUID()
    const instanceId = extractInstanceId(event)
    const occurredAt = new Date()

    await this.sql`
      INSERT INTO execution_events (id, instance_id, type, occurred_at, data)
      VALUES (${id}, ${instanceId}, ${event.type}, ${occurredAt}, ${this.sql.json(event as unknown as postgres.JSONValue)})
    `
  }

  async getForInstance(instanceId: string): Promise<StoredExecutionEvent[]> {
    const rows = await this.sql<Array<{
      id: string
      instance_id: string | null
      type: string
      occurred_at: Date
      data: unknown
    }>>`
      SELECT id, instance_id, type, occurred_at, data
      FROM execution_events
      WHERE instance_id = ${instanceId}
      ORDER BY occurred_at ASC
    `

    return rows.map(row => ({
      id: row.id,
      instanceId: row.instance_id,
      type: row.type,
      occurredAt: new Date(row.occurred_at),
      data: row.data as ExecutionEvent,
    }))
  }
}
