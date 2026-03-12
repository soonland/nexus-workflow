import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStateStore } from './InMemoryStateStore.js'
import { buildDefinition, buildSimpleSequenceDefinition } from '../../tests/fixtures/builders/ProcessDefinitionBuilder.js'
import { buildInstance } from '../../tests/fixtures/builders/ProcessInstanceBuilder.js'
import { buildToken } from '../../tests/fixtures/builders/TokenBuilder.js'
import type { VariableScope, EventSubscription, UserTaskRecord, HistoryEntry, ScheduledTimer } from '../model/types.js'

describe('InMemoryStateStore', () => {
  let store: InMemoryStateStore

  beforeEach(() => {
    store = new InMemoryStateStore()
  })

  // ─── Definitions ─────────────────────────────────────────────────────────────

  describe('Process Definitions', () => {
    it('returns null for an unknown definition', async () => {
      expect(await store.getDefinition('nonexistent')).toBeNull()
    })

    it('persists and retrieves a definition by id and version', async () => {
      const def = buildSimpleSequenceDefinition()
      await store.saveDefinition(def)
      expect(await store.getDefinition(def.id, def.version)).toEqual(def)
    })

    it('overwrites on save with the same id and version', async () => {
      const def = buildSimpleSequenceDefinition()
      await store.saveDefinition(def)
      const updated = { ...def, name: 'Updated Name' }
      await store.saveDefinition(updated)
      const result = await store.getDefinition(def.id, def.version)
      expect(result?.name).toBe('Updated Name')
    })

    it('returns the latest version when no version is specified', async () => {
      const v1 = buildDefinition({ id: 'proc-1', version: 1 })
      const v2 = buildDefinition({ id: 'proc-1', version: 2 })
      const v3 = buildDefinition({ id: 'proc-1', version: 3 })
      await store.saveDefinition(v1)
      await store.saveDefinition(v3)
      await store.saveDefinition(v2)
      const result = await store.getDefinition('proc-1')
      expect(result?.version).toBe(3)
    })

    it('isolates definitions with different ids', async () => {
      const a = buildDefinition({ id: 'proc-a', version: 1 })
      const b = buildDefinition({ id: 'proc-b', version: 1 })
      await store.saveDefinition(a)
      await store.saveDefinition(b)
      expect(await store.getDefinition('proc-a')).toEqual(a)
      expect(await store.getDefinition('proc-b')).toEqual(b)
    })
  })

  // ─── Instances ───────────────────────────────────────────────────────────────

  describe('Process Instances', () => {
    it('returns null for an unknown instance', async () => {
      expect(await store.getInstance('nonexistent')).toBeNull()
    })

    it('creates and retrieves an instance', async () => {
      const inst = buildInstance()
      await store.createInstance(inst)
      expect(await store.getInstance(inst.id)).toEqual(inst)
    })

    it('overwrites on update', async () => {
      const inst = buildInstance()
      await store.createInstance(inst)
      const updated = { ...inst, status: 'completed' as const }
      await store.updateInstance(updated)
      expect((await store.getInstance(inst.id))?.status).toBe('completed')
    })

    it('isolates state between different instance ids', async () => {
      const a = buildInstance({ id: 'inst-a' })
      const b = buildInstance({ id: 'inst-b' })
      await store.createInstance(a)
      await store.createInstance(b)
      const updatedA = { ...a, status: 'completed' as const }
      await store.updateInstance(updatedA)
      expect((await store.getInstance('inst-b'))?.status).toBe('active')
    })

    it('filters instances by status', async () => {
      await store.createInstance(buildInstance({ id: 'inst-1', status: 'active' }))
      await store.createInstance(buildInstance({ id: 'inst-2', status: 'completed' }))
      await store.createInstance(buildInstance({ id: 'inst-3', status: 'active' }))
      const result = await store.findInstances({ status: 'active', page: 0, pageSize: 10 })
      expect(result.total).toBe(2)
      expect(result.items.every(i => i.status === 'active')).toBe(true)
    })

    it('paginates results correctly', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createInstance(buildInstance({ id: `inst-${i}` }))
      }
      const page0 = await store.findInstances({ page: 0, pageSize: 2 })
      const page1 = await store.findInstances({ page: 1, pageSize: 2 })
      const page2 = await store.findInstances({ page: 2, pageSize: 2 })
      expect(page0.items).toHaveLength(2)
      expect(page1.items).toHaveLength(2)
      expect(page2.items).toHaveLength(1)
      expect(page0.total).toBe(5)
    })
  })

  // ─── Tokens ──────────────────────────────────────────────────────────────────

  describe('Tokens', () => {
    it('returns empty array for an instance with no tokens', async () => {
      expect(await store.getActiveTokens('inst-1')).toEqual([])
    })

    it('saves and retrieves active tokens', async () => {
      const token = buildToken({ id: 'tok-1', instanceId: 'inst-1', status: 'active' })
      await store.saveTokens([token])
      const active = await store.getActiveTokens('inst-1')
      expect(active).toHaveLength(1)
      expect(active[0]?.id).toBe('tok-1')
    })

    it('updates an existing token on save', async () => {
      const token = buildToken({ id: 'tok-1', status: 'active' })
      await store.saveTokens([token])
      await store.saveTokens([{ ...token, status: 'waiting' }])
      const all = await store.getAllTokens('inst-1')
      expect(all).toHaveLength(1)
      expect(all[0]?.status).toBe('waiting')
    })

    it('excludes cancelled and completed tokens from getActiveTokens', async () => {
      await store.saveTokens([
        buildToken({ id: 'tok-active',    status: 'active' }),
        buildToken({ id: 'tok-waiting',   status: 'waiting' }),
        buildToken({ id: 'tok-cancelled', status: 'cancelled' }),
        buildToken({ id: 'tok-completed', status: 'completed' }),
      ])
      const active = await store.getActiveTokens('inst-1')
      expect(active.map(t => t.id).sort()).toEqual(['tok-active', 'tok-waiting'])
    })

    it('isolates tokens by instanceId', async () => {
      await store.saveTokens([buildToken({ id: 'tok-a', instanceId: 'inst-a' })])
      await store.saveTokens([buildToken({ id: 'tok-b', instanceId: 'inst-b' })])
      expect(await store.getActiveTokens('inst-a')).toHaveLength(1)
      expect(await store.getActiveTokens('inst-b')).toHaveLength(1)
    })
  })

  // ─── Variable Scopes ──────────────────────────────────────────────────────────

  describe('Variable Scopes', () => {
    it('returns null for an unknown scope', async () => {
      expect(await store.getScope('nonexistent')).toBeNull()
    })

    it('saves and retrieves a scope', async () => {
      const scope: VariableScope = {
        id: 'scope-1',
        variables: { x: { type: 'number', value: 42 } },
      }
      await store.saveScope(scope)
      expect(await store.getScope('scope-1')).toEqual(scope)
    })

    it('returns the full scope chain from leaf to root', async () => {
      const root: VariableScope = { id: 'root', variables: { env: { type: 'string', value: 'prod' } } }
      const child: VariableScope = { id: 'child', parentScopeId: 'root', variables: {} }
      const leaf: VariableScope = { id: 'leaf', parentScopeId: 'child', variables: {} }
      await store.saveScope(root)
      await store.saveScope(child)
      await store.saveScope(leaf)
      const chain = await store.getScopeChain('leaf')
      expect(chain.map(s => s.id)).toEqual(['leaf', 'child', 'root'])
    })
  })

  // ─── Event Subscriptions ──────────────────────────────────────────────────────

  describe('Event Subscriptions', () => {
    const activeMessageSub = (id: string, messageName: string, correlationValue?: string): EventSubscription => ({
      id,
      instanceId: 'inst-1',
      tokenId: 'tok-1',
      type: 'message',
      messageName,
      ...(correlationValue !== undefined ? { correlationValue } : {}),
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    it('finds subscriptions by message name', async () => {
      await store.saveSubscription(activeMessageSub('sub-1', 'order.approved'))
      await store.saveSubscription(activeMessageSub('sub-2', 'order.rejected'))
      const found = await store.findSubscriptions({ type: 'message', messageName: 'order.approved' })
      expect(found).toHaveLength(1)
      expect(found[0]?.id).toBe('sub-1')
    })

    it('finds subscriptions by correlation value', async () => {
      await store.saveSubscription(activeMessageSub('sub-1', 'order.approved', 'order-123'))
      await store.saveSubscription(activeMessageSub('sub-2', 'order.approved', 'order-456'))
      const found = await store.findSubscriptions({ correlationValue: 'order-123' })
      expect(found).toHaveLength(1)
      expect(found[0]?.id).toBe('sub-1')
    })

    it('does not return resolved or cancelled subscriptions', async () => {
      await store.saveSubscription({ ...activeMessageSub('sub-1', 'msg'), status: 'resolved' })
      await store.saveSubscription({ ...activeMessageSub('sub-2', 'msg'), status: 'cancelled' })
      const found = await store.findSubscriptions({ type: 'message', messageName: 'msg' })
      expect(found).toHaveLength(0)
    })

    it('removes a subscription on delete', async () => {
      await store.saveSubscription(activeMessageSub('sub-1', 'msg'))
      await store.deleteSubscription('sub-1')
      const found = await store.findSubscriptions({ messageName: 'msg' })
      expect(found).toHaveLength(0)
    })
  })

  // ─── Gateway State ────────────────────────────────────────────────────────────

  describe('Gateway Join State', () => {
    it('returns null for unknown gateway state', async () => {
      expect(await store.getGatewayState('gw-1', 'inst-1')).toBeNull()
    })

    it('saves and retrieves parallel gateway join state', async () => {
      const state = {
        gatewayId: 'gw-1',
        instanceId: 'inst-1',
        activationId: 'act-1',
        arrivedFromFlows: ['flow_a'],
        expectedFlows: ['flow_a', 'flow_b', 'flow_c'],
      }
      await store.saveGatewayState(state)
      expect(await store.getGatewayState('gw-1', 'inst-1')).toEqual(state)
    })

    it('isolates gateway state by (gatewayId, instanceId)', async () => {
      await store.saveGatewayState({ gatewayId: 'gw-1', instanceId: 'inst-1', activationId: 'a1', arrivedFromFlows: [], expectedFlows: ['flow_a'] })
      await store.saveGatewayState({ gatewayId: 'gw-1', instanceId: 'inst-2', activationId: 'a2', arrivedFromFlows: [], expectedFlows: ['flow_b'] })
      const s1 = await store.getGatewayState('gw-1', 'inst-1')
      expect(s1?.expectedFlows).toEqual(['flow_a'])
      const s2 = await store.getGatewayState('gw-1', 'inst-2')
      expect(s2?.expectedFlows).toEqual(['flow_b'])
    })

    it('removes gateway state on delete', async () => {
      await store.saveGatewayState({ gatewayId: 'gw-1', instanceId: 'inst-1', activationId: 'a1', arrivedFromFlows: [], expectedFlows: ['flow_a'] })
      await store.deleteGatewayState('gw-1', 'inst-1')
      expect(await store.getGatewayState('gw-1', 'inst-1')).toBeNull()
    })
  })

  // ─── Atomic Transaction ───────────────────────────────────────────────────────

  describe('executeTransaction', () => {
    it('applies all operations in sequence', async () => {
      const inst = buildInstance()
      const token = buildToken()

      await store.executeTransaction([
        { op: 'createInstance', instance: inst },
        { op: 'saveTokens', tokens: [token] },
      ])

      expect(await store.getInstance(inst.id)).toEqual(inst)
      expect(await store.getActiveTokens(inst.id)).toHaveLength(1)
    })
  })

  // ─── User Tasks ───────────────────────────────────────────────────────────────

  describe('User Tasks', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')

    function makeTask(overrides: Partial<UserTaskRecord> = {}): UserTaskRecord {
      return {
        id: 'task-1',
        instanceId: 'inst-1',
        tokenId: 'tok-1',
        elementId: 'ut_1',
        name: 'Review',
        priority: 50,
        inputVariables: {},
        status: 'open',
        createdAt: now,
        ...overrides,
      }
    }

    it('returns null for an unknown user task', async () => {
      expect(await store.getUserTask('nonexistent')).toBeNull()
    })

    it('creates and retrieves a user task by id', async () => {
      const task = makeTask()
      await store.createUserTask(task)
      expect(await store.getUserTask('task-1')).toEqual(task)
    })

    it('updates a user task', async () => {
      const task = makeTask()
      await store.createUserTask(task)
      await store.updateUserTask({ ...task, status: 'completed' })
      expect((await store.getUserTask('task-1'))?.status).toBe('completed')
    })

    it('queryUserTasks filters by instanceId', async () => {
      await store.createUserTask(makeTask({ id: 'task-1', instanceId: 'inst-1' }))
      await store.createUserTask(makeTask({ id: 'task-2', instanceId: 'inst-2' }))
      const result = await store.queryUserTasks({ instanceId: 'inst-1', page: 0, pageSize: 10 })
      expect(result.total).toBe(1)
      expect(result.items[0]?.instanceId).toBe('inst-1')
    })

    it('queryUserTasks filters by assignee', async () => {
      await store.createUserTask(makeTask({ id: 'task-1', assignee: 'alice' }))
      await store.createUserTask(makeTask({ id: 'task-2', assignee: 'bob' }))
      const result = await store.queryUserTasks({ assignee: 'alice', page: 0, pageSize: 10 })
      expect(result.total).toBe(1)
      expect(result.items[0]?.assignee).toBe('alice')
    })

    it('queryUserTasks filters by candidateGroup', async () => {
      await store.createUserTask(makeTask({ id: 'task-1', candidateGroups: ['hr', 'finance'] }))
      await store.createUserTask(makeTask({ id: 'task-2', candidateGroups: ['engineering'] }))
      const result = await store.queryUserTasks({ candidateGroup: 'hr', page: 0, pageSize: 10 })
      expect(result.total).toBe(1)
      expect(result.items[0]?.id).toBe('task-1')
    })

    it('queryUserTasks filters by a single status string', async () => {
      await store.createUserTask(makeTask({ id: 'task-1', status: 'open' }))
      await store.createUserTask(makeTask({ id: 'task-2', status: 'completed' }))
      const result = await store.queryUserTasks({ status: 'open', page: 0, pageSize: 10 })
      expect(result.total).toBe(1)
      expect(result.items[0]?.status).toBe('open')
    })

    it('queryUserTasks filters by an array of statuses', async () => {
      await store.createUserTask(makeTask({ id: 'task-1', status: 'open' }))
      await store.createUserTask(makeTask({ id: 'task-2', status: 'claimed' }))
      await store.createUserTask(makeTask({ id: 'task-3', status: 'completed' }))
      const result = await store.queryUserTasks({ status: ['open', 'claimed'], page: 0, pageSize: 10 })
      expect(result.total).toBe(2)
    })

    it('queryUserTasks paginates correctly', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createUserTask(makeTask({ id: `task-${i}` }))
      }
      const page0 = await store.queryUserTasks({ page: 0, pageSize: 2 })
      const page1 = await store.queryUserTasks({ page: 1, pageSize: 2 })
      expect(page0.items).toHaveLength(2)
      expect(page1.items).toHaveLength(2)
      expect(page0.total).toBe(5)
    })

    it('queryUserTasks with no filters returns all tasks', async () => {
      await store.createUserTask(makeTask({ id: 'task-1' }))
      await store.createUserTask(makeTask({ id: 'task-2' }))
      const result = await store.queryUserTasks({ page: 0, pageSize: 10 })
      expect(result.total).toBe(2)
    })
  })

  // ─── History ──────────────────────────────────────────────────────────────────

  describe('History', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')

    function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
      return {
        id: 'he-1',
        instanceId: 'inst-1',
        tokenId: 'tok-1',
        elementId: 'task_1',
        elementType: 'serviceTask',
        status: 'completed',
        startedAt: now,
        completedAt: now,
        ...overrides,
      }
    }

    it('returns an empty array for an instance with no history', async () => {
      expect(await store.getHistory('nonexistent')).toEqual([])
    })

    it('appends and retrieves history entries in order', async () => {
      await store.appendHistory(makeEntry({ id: 'he-1' }))
      await store.appendHistory(makeEntry({ id: 'he-2' }))
      const history = await store.getHistory('inst-1')
      expect(history).toHaveLength(2)
      expect(history.map(h => h.id)).toEqual(['he-1', 'he-2'])
    })

    it('isolates history by instanceId', async () => {
      await store.appendHistory(makeEntry({ id: 'he-a', instanceId: 'inst-a' }))
      await store.appendHistory(makeEntry({ id: 'he-b', instanceId: 'inst-b' }))
      expect(await store.getHistory('inst-a')).toHaveLength(1)
      expect(await store.getHistory('inst-b')).toHaveLength(1)
    })

    it('returns a defensive copy so mutations do not affect stored history', async () => {
      await store.appendHistory(makeEntry({ id: 'he-1' }))
      const history = await store.getHistory('inst-1')
      history.push(makeEntry({ id: 'he-extra' }))
      expect(await store.getHistory('inst-1')).toHaveLength(1)
    })
  })

  // ─── Timers ───────────────────────────────────────────────────────────────────

  describe('Timers', () => {
    const now = new Date('2026-01-01T12:00:00.000Z')

    function makeTimer(id: string, fireAt: Date): ScheduledTimer {
      return {
        id,
        instanceId: 'inst-1',
        tokenId: `tok-${id}`,
        fireAt,
        createdAt: now,
      }
    }

    it('saves and retrieves due timers', async () => {
      const past = new Date(now.getTime() - 1000)
      await store.saveTimer(makeTimer('t1', past))
      const due = await store.getDueTimers(now)
      expect(due).toHaveLength(1)
      expect(due[0]?.id).toBe('t1')
    })

    it('getDueTimers does not return timers in the future', async () => {
      const future = new Date(now.getTime() + 60_000)
      await store.saveTimer(makeTimer('t-future', future))
      const due = await store.getDueTimers(now)
      expect(due).toHaveLength(0)
    })

    it('deleteTimer removes a timer', async () => {
      await store.saveTimer(makeTimer('t1', new Date(now.getTime() - 1)))
      await store.deleteTimer('t1')
      const due = await store.getDueTimers(now)
      expect(due).toHaveLength(0)
    })

    it('getAllTimers returns all stored timers regardless of fireAt', async () => {
      await store.saveTimer(makeTimer('t1', new Date(now.getTime() - 1000)))
      await store.saveTimer(makeTimer('t2', new Date(now.getTime() + 60_000)))
      expect(store.getAllTimers()).toHaveLength(2)
    })
  })

  // ─── Subscription filters (signal and instanceId) ─────────────────────────────

  describe('Event Subscriptions — additional filters', () => {
    const ts = new Date('2026-01-01T00:00:00.000Z')

    function makeSignalSub(id: string, signalName: string, instanceId = 'inst-1'): EventSubscription {
      return {
        id,
        instanceId,
        tokenId: 'tok-1',
        type: 'signal',
        signalName,
        status: 'active',
        createdAt: ts,
      }
    }

    it('findSubscriptions filters by signalName', async () => {
      await store.saveSubscription(makeSignalSub('sub-1', 'order.shipped'))
      await store.saveSubscription(makeSignalSub('sub-2', 'order.cancelled'))
      const found = await store.findSubscriptions({ signalName: 'order.shipped' })
      expect(found).toHaveLength(1)
      expect(found[0]?.id).toBe('sub-1')
    })

    it('findSubscriptions filters by instanceId', async () => {
      await store.saveSubscription(makeSignalSub('sub-1', 'sig', 'inst-a'))
      await store.saveSubscription(makeSignalSub('sub-2', 'sig', 'inst-b'))
      const found = await store.findSubscriptions({ instanceId: 'inst-a' })
      expect(found).toHaveLength(1)
      expect(found[0]?.instanceId).toBe('inst-a')
    })

    it('findSubscriptions with no filter returns all active subscriptions', async () => {
      await store.saveSubscription(makeSignalSub('sub-1', 'sig-a'))
      await store.saveSubscription(makeSignalSub('sub-2', 'sig-b'))
      const found = await store.findSubscriptions({})
      expect(found).toHaveLength(2)
    })
  })

  // ─── listDefinitions ──────────────────────────────────────────────────────────

  describe('listDefinitions', () => {
    it('returns all definitions when no filter is provided', async () => {
      await store.saveDefinition(buildDefinition({ id: 'p1', version: 1, isDeployable: true }))
      await store.saveDefinition(buildDefinition({ id: 'p2', version: 1, isDeployable: false }))
      const all = await store.listDefinitions()
      expect(all).toHaveLength(2)
    })

    it('filters by isDeployable = true', async () => {
      await store.saveDefinition(buildDefinition({ id: 'p1', version: 1, isDeployable: true }))
      await store.saveDefinition(buildDefinition({ id: 'p2', version: 1, isDeployable: false }))
      const deployable = await store.listDefinitions({ isDeployable: true })
      expect(deployable.every(d => d.isDeployable)).toBe(true)
      expect(deployable).toHaveLength(1)
    })

    it('filters by isDeployable = false', async () => {
      await store.saveDefinition(buildDefinition({ id: 'p1', version: 1, isDeployable: true }))
      await store.saveDefinition(buildDefinition({ id: 'p2', version: 1, isDeployable: false }))
      const notDeployable = await store.listDefinitions({ isDeployable: false })
      expect(notDeployable).toHaveLength(1)
      expect(notDeployable[0]?.id).toBe('p2')
    })

    it('includes name in summary when definition has a name', async () => {
      await store.saveDefinition(buildDefinition({ id: 'p1', version: 1, name: 'My Process' }))
      const list = await store.listDefinitions()
      expect(list[0]?.name).toBe('My Process')
    })
  })

  // ─── Gateway State — listGatewayStates ────────────────────────────────────────

  describe('Gateway Join State — listGatewayStates', () => {
    it('returns all gateway states for a given instance', async () => {
      await store.saveGatewayState({ gatewayId: 'gw-1', instanceId: 'inst-1', activationId: 'a1', arrivedFromFlows: [], expectedFlows: ['f1'] })
      await store.saveGatewayState({ gatewayId: 'gw-2', instanceId: 'inst-1', activationId: 'a2', arrivedFromFlows: [], expectedFlows: ['f2'] })
      await store.saveGatewayState({ gatewayId: 'gw-3', instanceId: 'inst-2', activationId: 'a3', arrivedFromFlows: [], expectedFlows: ['f3'] })
      const states = await store.listGatewayStates('inst-1')
      expect(states).toHaveLength(2)
      expect(states.every(s => s.instanceId === 'inst-1')).toBe(true)
    })

    it('returns empty array when instance has no gateway states', async () => {
      const states = await store.listGatewayStates('nonexistent')
      expect(states).toHaveLength(0)
    })
  })

  // ─── findInstances — additional filters ───────────────────────────────────────

  describe('findInstances — additional filters', () => {
    const baseDate = new Date('2026-01-10T12:00:00.000Z')

    it('filters by definitionId', async () => {
      await store.createInstance(buildInstance({ id: 'i1', definitionId: 'def-a' }))
      await store.createInstance(buildInstance({ id: 'i2', definitionId: 'def-b' }))
      const result = await store.findInstances({ definitionId: 'def-a', page: 0, pageSize: 10 })
      expect(result.total).toBe(1)
      expect(result.items[0]?.definitionId).toBe('def-a')
    })

    it('filters by correlationKey', async () => {
      await store.createInstance(buildInstance({ id: 'i1', correlationKey: 'order-123' }))
      await store.createInstance(buildInstance({ id: 'i2', correlationKey: 'order-456' }))
      const result = await store.findInstances({ correlationKey: 'order-123', page: 0, pageSize: 10 })
      expect(result.total).toBe(1)
    })

    it('filters by businessKey', async () => {
      await store.createInstance(buildInstance({ id: 'i1', businessKey: 'bk-1' }))
      await store.createInstance(buildInstance({ id: 'i2' }))
      const result = await store.findInstances({ businessKey: 'bk-1', page: 0, pageSize: 10 })
      expect(result.total).toBe(1)
    })

    it('filters by startedAfter', async () => {
      const before = new Date(baseDate.getTime() - 1000)
      const after = new Date(baseDate.getTime() + 1000)
      await store.createInstance(buildInstance({ id: 'i1', startedAt: before }))
      await store.createInstance(buildInstance({ id: 'i2', startedAt: after }))
      const result = await store.findInstances({ startedAfter: baseDate, page: 0, pageSize: 10 })
      expect(result.total).toBe(1)
      expect(result.items[0]?.id).toBe('i2')
    })

    it('filters by startedBefore', async () => {
      const before = new Date(baseDate.getTime() - 1000)
      const after = new Date(baseDate.getTime() + 1000)
      await store.createInstance(buildInstance({ id: 'i1', startedAt: before }))
      await store.createInstance(buildInstance({ id: 'i2', startedAt: after }))
      const result = await store.findInstances({ startedBefore: baseDate, page: 0, pageSize: 10 })
      expect(result.total).toBe(1)
      expect(result.items[0]?.id).toBe('i1')
    })

    it('filters by array of statuses', async () => {
      await store.createInstance(buildInstance({ id: 'i1', status: 'active' }))
      await store.createInstance(buildInstance({ id: 'i2', status: 'completed' }))
      await store.createInstance(buildInstance({ id: 'i3', status: 'suspended' }))
      const result = await store.findInstances({ status: ['active', 'suspended'], page: 0, pageSize: 10 })
      expect(result.total).toBe(2)
    })

    it('summary omits completedAt when undefined', async () => {
      await store.createInstance(buildInstance({ id: 'i1', status: 'active' }))
      const result = await store.findInstances({ page: 0, pageSize: 10 })
      expect(result.items[0]).not.toHaveProperty('completedAt')
    })

    it('summary omits correlationKey when undefined', async () => {
      await store.createInstance(buildInstance({ id: 'i1' }))
      const result = await store.findInstances({ page: 0, pageSize: 10 })
      // correlationKey should not be present in summary if not set
      expect('correlationKey' in result.items[0]!).toBe(false)
    })
  })

  // ─── getAllInstances / getAllSubscriptions test helpers ────────────────────────

  describe('test helper snapshots', () => {
    it('getAllInstances returns all stored instances', async () => {
      await store.createInstance(buildInstance({ id: 'i1' }))
      await store.createInstance(buildInstance({ id: 'i2' }))
      expect(store.getAllInstances()).toHaveLength(2)
    })

    it('getAllSubscriptions returns all stored subscriptions', async () => {
      const sub: EventSubscription = {
        id: 'sub-1',
        instanceId: 'inst-1',
        tokenId: 'tok-1',
        type: 'message',
        messageName: 'test',
        status: 'active',
        createdAt: new Date(),
      }
      await store.saveSubscription(sub)
      expect(store.getAllSubscriptions()).toHaveLength(1)
      expect(store.getAllSubscriptions()[0]?.id).toBe('sub-1')
    })
  })

  // ─── executeTransaction — full operation coverage ─────────────────────────────

  describe('executeTransaction — full operation set', () => {
    it('executes updateInstance operation', async () => {
      const inst = buildInstance()
      await store.createInstance(inst)
      await store.executeTransaction([{ op: 'updateInstance', instance: { ...inst, status: 'completed' } }])
      expect((await store.getInstance(inst.id))?.status).toBe('completed')
    })

    it('executes saveScope operation', async () => {
      const scope: VariableScope = { id: 'scope-tx', variables: { x: { type: 'number', value: 99 } } }
      await store.executeTransaction([{ op: 'saveScope', scope }])
      expect(await store.getScope('scope-tx')).toEqual(scope)
    })

    it('executes createUserTask and updateUserTask operations', async () => {
      const now = new Date()
      const task: UserTaskRecord = {
        id: 'task-tx',
        instanceId: 'inst-1',
        tokenId: 'tok-1',
        elementId: 'ut_1',
        name: 'Approve',
        priority: 50,
        inputVariables: {},
        status: 'open',
        createdAt: now,
      }
      await store.executeTransaction([
        { op: 'createUserTask', task },
        { op: 'updateUserTask', task: { ...task, status: 'completed' } },
      ])
      expect((await store.getUserTask('task-tx'))?.status).toBe('completed')
    })

    it('executes saveSubscription and deleteSubscription operations', async () => {
      const sub: EventSubscription = {
        id: 'sub-tx',
        instanceId: 'inst-1',
        tokenId: 'tok-1',
        type: 'message',
        messageName: 'test',
        status: 'active',
        createdAt: new Date(),
      }
      await store.executeTransaction([
        { op: 'saveSubscription', subscription: sub },
        { op: 'deleteSubscription', id: 'sub-tx' },
      ])
      const found = await store.findSubscriptions({ messageName: 'test' })
      expect(found).toHaveLength(0)
    })

    it('executes saveGatewayState and deleteGatewayState operations', async () => {
      const state = { gatewayId: 'gw-tx', instanceId: 'inst-1', activationId: 'a1', arrivedFromFlows: [], expectedFlows: ['f1'] }
      await store.executeTransaction([
        { op: 'saveGatewayState', state },
        { op: 'deleteGatewayState', gatewayId: 'gw-tx', instanceId: 'inst-1' },
      ])
      expect(await store.getGatewayState('gw-tx', 'inst-1')).toBeNull()
    })

    it('executes appendHistory operation', async () => {
      const entry: HistoryEntry = {
        id: 'he-tx',
        instanceId: 'inst-tx',
        tokenId: 'tok-1',
        elementId: 'task_1',
        elementType: 'serviceTask',
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
      }
      await store.executeTransaction([{ op: 'appendHistory', entry }])
      const history = await store.getHistory('inst-tx')
      expect(history).toHaveLength(1)
      expect(history[0]?.id).toBe('he-tx')
    })

    it('executes saveDefinition operation', async () => {
      const def = buildSimpleSequenceDefinition()
      await store.executeTransaction([{ op: 'saveDefinition', definition: def }])
      expect(await store.getDefinition(def.id, def.version)).toEqual(def)
    })

    it('executes saveTimer and deleteTimer operations', async () => {
      const timer: ScheduledTimer = {
        id: 'timer-tx',
        instanceId: 'inst-1',
        tokenId: 'tok-1',
        fireAt: new Date(Date.now() - 1),
        createdAt: new Date(),
      }
      await store.executeTransaction([
        { op: 'saveTimer', timer },
        { op: 'deleteTimer', id: 'timer-tx' },
      ])
      const due = await store.getDueTimers(new Date())
      expect(due.find(t => t.id === 'timer-tx')).toBeUndefined()
    })
  })

  // ─── Tokens — suspended status included in getActiveTokens ────────────────────

  describe('Tokens — suspended status', () => {
    it('includes suspended tokens in getActiveTokens', async () => {
      await store.saveTokens([
        buildToken({ id: 'tok-suspended', status: 'suspended' }),
      ])
      const active = await store.getActiveTokens('inst-1')
      expect(active.some(t => t.id === 'tok-suspended')).toBe(true)
    })
  })

  // ─── Reset ────────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all stored state', async () => {
      await store.createInstance(buildInstance())
      await store.saveTokens([buildToken()])
      store.reset()
      expect(await store.getInstance('inst-1')).toBeNull()
      expect(await store.getActiveTokens('inst-1')).toEqual([])
    })
  })
})
