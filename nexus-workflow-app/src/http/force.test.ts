import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { InMemoryEventBus, InMemoryStateStore, parseBpmn, type ExecutionEvent } from 'nexus-workflow-core'
import type { Principal } from '../auth/principal.js'
import type { AuditLog } from '../db/AuditLog.js'
import { createForceRouter } from './force.js'
import { createInstancesRouter } from './instances.js'
import type { AppVariables } from './middleware/auth.js'

// ─── Definitions ──────────────────────────────────────────────────────────────

const wrap = (body: string, id: string) => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:nexus="http://nexus-workflow/extensions" targetNamespace="http://example.com">
  <process id="${id}" name="${id}" isExecutable="true">${body}</process>
</definitions>`

const USER_TASK = wrap(
  `<startEvent id="start"><outgoing>f1</outgoing></startEvent>
   <userTask id="review" name="Review"><incoming>f1</incoming><outgoing>f2</outgoing></userTask>
   <endEvent id="end"><incoming>f2</incoming></endEvent>
   <sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
   <sequenceFlow id="f2" sourceRef="review" targetRef="end"/>`,
  'user-proc',
)

const SERVICE_TASK = wrap(
  `<startEvent id="start"><outgoing>f1</outgoing></startEvent>
   <serviceTask id="send" name="Send" nexus:type="send-email"><incoming>f1</incoming><outgoing>f2</outgoing></serviceTask>
   <endEvent id="end"><incoming>f2</incoming></endEvent>
   <sequenceFlow id="f1" sourceRef="start" targetRef="send"/>
   <sequenceFlow id="f2" sourceRef="send" targetRef="end"/>`,
  'service-proc',
)

const TIMER = wrap(
  `<startEvent id="start"><outgoing>f1</outgoing></startEvent>
   <intermediateCatchEvent id="wait"><incoming>f1</incoming><outgoing>f2</outgoing><timerEventDefinition><timeDuration>PT1H</timeDuration></timerEventDefinition></intermediateCatchEvent>
   <endEvent id="end"><incoming>f2</incoming></endEvent>
   <sequenceFlow id="f1" sourceRef="start" targetRef="wait"/>
   <sequenceFlow id="f2" sourceRef="wait" targetRef="end"/>`,
  'timer-proc',
)

const person = (email: string): Principal => ({
  kind: 'user',
  user: { id: `id-${email}`, email, name: email, status: 'active', createdAt: new Date(), lastLoginAt: null, hasPassword: true },
  memberships: [{ id: 'm1', userId: `id-${email}`, role: 'tenant_manager', tenantId: 'acme', createdAt: new Date() }],
})

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('POST /instances/:id/force', () => {
  let store: InMemoryStateStore
  let bus: InMemoryEventBus
  let published: ExecutionEvent[]
  let record: ReturnType<typeof vi.fn>
  let principal: Principal | undefined
  let app: Hono<{ Variables: AppVariables }>

  beforeEach(async () => {
    store = new InMemoryStateStore()
    bus = new InMemoryEventBus()
    published = []
    bus.subscribe((e) => void published.push(e))
    record = vi.fn().mockResolvedValue(undefined)
    principal = person('manager@example.com')
    for (const xml of [USER_TASK, SERVICE_TASK, TIMER]) await store.saveDefinition(parseBpmn(xml).definition!)

    app = new Hono<{ Variables: AppVariables }>()
    app.use('*', async (c, next) => {
      c.set('tenantId', 'acme')
      if (principal) c.set('principal', principal)
      return next()
    })
    app.route('/', createInstancesRouter(() => store, () => bus))
    app.route('/', createForceRouter(() => store, () => bus, { record } as unknown as AuditLog))
  })

  async function start(definitionId: string) {
    const res = await app.fetch(new Request(`http://localhost/definitions/${definitionId}/instances`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))
    const body = await res.json()
    const waiting = (body.tokens as Array<{ id: string; status: string; elementId: string }>).find((t) => t.status === 'waiting')!
    return { instanceId: body.instance.id as string, tokenId: waiting.id }
  }

  const force = async (instanceId: string, body: Record<string, unknown>) => {
    const res = await app.fetch(new Request(`http://localhost/instances/${instanceId}/force`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }

  const history = async (instanceId: string) => store.getHistory(instanceId)

  // ─── the four actions ──────────────────────────────────────────────────────

  it('completes a stuck service task, with output variables, and says so everywhere', async () => {
    const { instanceId, tokenId } = await start('service-proc')

    const res = await force(instanceId, { action: 'completeServiceTask', tokenId, reason: 'The mail server is down; sent by hand', outputVariables: { sent: true } })

    expect(res.status).toBe(200)
    expect(res.body['instance'].status).toBe('completed')
    // history: the step is tagged with who and why
    const send = (await history(instanceId)).find((e) => e.elementId === 'send')!
    expect(send.status).toBe('completed')
    expect(send.forced).toEqual({ action: 'completeServiceTask', by: 'manager@example.com', reason: 'The mail server is down; sent by hand' })
    // the event log / bus
    const marker = published.find((e) => e.type === 'StepForced')
    expect(marker).toMatchObject({ instanceId, tokenId, elementId: 'send', action: 'completeServiceTask', forcedBy: 'manager@example.com', reason: 'The mail server is down; sent by hand' })
    // the audit log
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'step.force',
        actor: { kind: 'user', id: 'id-manager@example.com', label: 'manager@example.com' },
        tenantIds: ['acme'],
        target: instanceId,
        details: { step: 'completeServiceTask', elementId: 'send', reason: 'The mail server is down; sent by hand' },
      }),
    )
  })

  it('fails a stuck service task, with the reason as the error message unless one is given', async () => {
    const { instanceId, tokenId } = await start('service-proc')

    const res = await force(instanceId, { action: 'failServiceTask', tokenId, reason: 'Gave up waiting for the provider' })

    expect(res.status).toBe(200)
    const instance = await store.getInstance(instanceId)
    expect(instance!.status).toBe('suspended') // no error boundary: it waits for an administrator
    const step = published.find((e) => e.type === 'ServiceTaskFailed')
    expect(step).toMatchObject({ error: expect.stringContaining('Gave up waiting for the provider') })
  })

  it('pushes a service task along after its failure suspended the instance: it resumes and finishes', async () => {
    const { instanceId, tokenId } = await start('service-proc')
    // what the worker does when no handler is registered for the task type
    await force(instanceId, { action: 'failServiceTask', tokenId, reason: 'no handler', error: { code: 'HANDLER_NOT_FOUND', message: 'No handler registered' } })
    expect((await store.getInstance(instanceId))!.status).toBe('suspended')

    const res = await force(instanceId, { action: 'completeServiceTask', tokenId, reason: 'sent by hand' })

    expect(res.status).toBe(200)
    expect(res.body['instance'].status).toBe('completed')
    const send = (await history(instanceId)).find((e) => e.elementId === 'send' && e.forced?.action === 'completeServiceTask')
    expect(send?.forced?.reason).toBe('sent by hand')
  })

  it('fires a timer now', async () => {
    const { instanceId, tokenId } = await start('timer-proc')

    const res = await force(instanceId, { action: 'fireTimer', tokenId, reason: 'Customer called, no need to wait' })

    expect(res.status).toBe(200)
    expect(res.body['instance'].status).toBe('completed')
    expect((await history(instanceId)).find((e) => e.elementId === 'wait')?.forced).toMatchObject({ action: 'fireTimer', reason: 'Customer called, no need to wait' })
  })

  it('completes a task for someone else: recorded against the manager, on behalf of the assignee, and the task is closed', async () => {
    const { instanceId, tokenId } = await start('user-proc')
    const [task] = (await store.queryUserTasks({ instanceId, page: 0, pageSize: 10 })).items
    await store.updateUserTask({ ...task!, status: 'claimed', assignee: 'ada@example.com' })

    const res = await force(instanceId, { action: 'completeUserTask', tokenId, reason: 'Ada is on leave', outputVariables: { decision: 'approved' } })

    expect(res.status).toBe(200)
    expect(res.body['instance'].status).toBe('completed')
    const closed = await store.getUserTask(task!.id)
    expect(closed!.status).toBe('completed')
    const step = (await history(instanceId)).find((e) => e.elementId === 'review')!
    expect(step.forced).toEqual({ action: 'completeUserTask', by: 'manager@example.com', reason: 'Ada is on leave', onBehalfOf: 'ada@example.com' })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ onBehalfOf: 'ada@example.com' }) }))
    expect(published.find((e) => e.type === 'StepForced')).toMatchObject({ forcedBy: 'manager@example.com', onBehalfOf: 'ada@example.com' })
  })

  // ─── refusals ──────────────────────────────────────────────────────────────

  describe('refusals leave the instance and the logs untouched', () => {
    const untouched = async (instanceId: string) => {
      expect((await store.getInstance(instanceId))!.status).toBe('active')
      expect(record).not.toHaveBeenCalled()
      expect(published.some((e) => e.type === 'StepForced')).toBe(false)
    }

    it('400 without a reason, or with a blank one', async () => {
      const { instanceId, tokenId } = await start('service-proc')

      for (const reason of [undefined, '', '   ', 42]) {
        const res = await force(instanceId, { action: 'completeServiceTask', tokenId, ...(reason === undefined ? {} : { reason }) })
        expect(res.status).toBe(400)
        expect(res.body['message']).toMatch(/reason/i)
      }
      await untouched(instanceId)
    })

    it('400 for an over-long reason, an unknown action, a missing token or malformed fields', async () => {
      const { instanceId, tokenId } = await start('service-proc')

      expect((await force(instanceId, { action: 'completeServiceTask', tokenId, reason: 'x'.repeat(501) })).status).toBe(400)
      expect((await force(instanceId, { action: 'teleport', tokenId, reason: 'why' })).status).toBe(400)
      expect((await force(instanceId, { action: 'fireTimer', reason: 'why' })).status).toBe(400)
      expect((await force(instanceId, { action: 'completeServiceTask', tokenId, reason: 'why', outputVariables: [1] })).status).toBe(400)
      await untouched(instanceId)
    })

    it('403 for a tenant API key or nobody: the reason has to be attributed to a person', async () => {
      const { instanceId, tokenId } = await start('service-proc')

      principal = { kind: 'apiKey', tenantId: 'acme' }
      expect((await force(instanceId, { action: 'completeServiceTask', tokenId, reason: 'why' })).status).toBe(403)
      principal = undefined
      expect((await force(instanceId, { action: 'completeServiceTask', tokenId, reason: 'why' })).status).toBe(403)
      await untouched(instanceId)
    })

    it('403 for a person who does not manage this tenant: an operator, or a manager of another one', async () => {
      const { instanceId, tokenId } = await start('service-proc')
      const operator: Principal = { ...person('op@example.com'), memberships: [{ id: 'm', userId: 'u', role: 'operator', tenantId: null, createdAt: new Date() }] }
      const elsewhere: Principal = { ...person('other@example.com'), memberships: [{ id: 'm', userId: 'u', role: 'tenant_manager', tenantId: 'globex', createdAt: new Date() }] }

      for (const who of [operator, elsewhere]) {
        principal = who
        expect((await force(instanceId, { action: 'completeServiceTask', tokenId, reason: 'why' })).status).toBe(403)
      }
      await untouched(instanceId)
    })

    it('404 for an instance that is not there', async () => {
      expect((await force('nope', { action: 'fireTimer', tokenId: 't', reason: 'why' })).status).toBe(404)
    })

    it('409 when the step is no longer the one the instance is waiting at', async () => {
      const { instanceId, tokenId } = await start('service-proc')
      await force(instanceId, { action: 'completeServiceTask', tokenId, reason: 'first time' })
      record.mockClear()

      const again = await force(instanceId, { action: 'completeServiceTask', tokenId, reason: 'second time' })

      expect(again.status).toBe(409)
      expect(again.body['error']).toBe('STEP_NOT_CURRENT')
      expect(record).not.toHaveBeenCalled()
      expect(published.filter((e) => e.type === 'StepForced')).toHaveLength(1)
    })

    it('409 for a token that does not belong to the instance', async () => {
      const { instanceId } = await start('service-proc')
      const other = await start('timer-proc')

      const res = await force(instanceId, { action: 'fireTimer', tokenId: other.tokenId, reason: 'why' })

      expect(res.status).toBe(409)
      await untouched(instanceId)
    })

    it('422 when the action does not fit the step (a timer cannot be completed as a task)', async () => {
      const timer = await start('timer-proc')
      const service = await start('service-proc')

      const wrongForTimer = await force(timer.instanceId, { action: 'completeServiceTask', tokenId: timer.tokenId, reason: 'why' })
      const wrongForService = await force(service.instanceId, { action: 'completeUserTask', tokenId: service.tokenId, reason: 'why' })

      expect(wrongForTimer.status).toBe(422)
      expect(wrongForTimer.body['error']).toBe('WRONG_STEP_KIND')
      expect(wrongForService.status).toBe(422)
      await untouched(timer.instanceId)
      await untouched(service.instanceId)
    })
  })

  it('keeps the reason trimmed', async () => {
    const { instanceId, tokenId } = await start('timer-proc')

    await force(instanceId, { action: 'fireTimer', tokenId, reason: '   spaced out   ' })

    expect((await history(instanceId)).find((e) => e.elementId === 'wait')?.forced?.reason).toBe('spaced out')
  })
})
