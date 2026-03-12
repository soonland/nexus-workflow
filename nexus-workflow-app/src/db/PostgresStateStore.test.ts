import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import postgres from 'postgres'
import type {
  ProcessDefinition,
  ProcessInstance,
  Token,
  VariableScope,
  UserTaskRecord,
  EventSubscription,
  GatewayJoinState,
  HistoryEntry,
  ScheduledTimer,
} from 'nexus-workflow-core'
import { PostgresStateStore } from './PostgresStateStore.js'
import { runMigrations } from './migrate.js'

// ─── Configuration ────────────────────────────────────────────────────────────

const TEST_DB_URL = process.env['DATABASE_URL'] ?? 'postgres://localhost/nexus_workflow_test'
const hasDb = Boolean(process.env['DATABASE_URL'])

// ─── Fixture Builders ─────────────────────────────────────────────────────────

function makeDefinition(overrides: Partial<ProcessDefinition> = {}): ProcessDefinition {
  return {
    id: 'def-1',
    version: 1,
    name: 'Test Process',
    elements: [],
    sequenceFlows: [],
    startEventId: 'start-1',
    deployedAt: new Date('2024-01-01T00:00:00.000Z'),
    isDeployable: true,
    ...overrides,
  }
}

function makeInstance(overrides: Partial<ProcessInstance> = {}): ProcessInstance {
  return {
    id: 'inst-1',
    definitionId: 'def-1',
    definitionVersion: 1,
    status: 'active',
    rootScopeId: 'scope-root',
    startedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeToken(overrides: Partial<Token> = {}): Token {
  return {
    id: 'tok-1',
    instanceId: 'inst-1',
    elementId: 'task-1',
    elementType: 'serviceTask',
    status: 'active',
    scopeId: 'scope-1',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeScope(overrides: Partial<VariableScope> = {}): VariableScope {
  return {
    id: 'scope-1',
    variables: {},
    ...overrides,
  }
}

function makeUserTask(overrides: Partial<UserTaskRecord> = {}): UserTaskRecord {
  return {
    id: 'task-1',
    instanceId: 'inst-1',
    tokenId: 'tok-1',
    elementId: 'user-task-1',
    name: 'Review Document',
    priority: 50,
    inputVariables: {},
    status: 'open',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeSubscription(overrides: Partial<EventSubscription> = {}): EventSubscription {
  return {
    id: 'sub-1',
    instanceId: 'inst-1',
    tokenId: 'tok-1',
    type: 'message',
    messageName: 'order.approved',
    status: 'active',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeParallelGatewayState(overrides: Partial<GatewayJoinState> = {}): GatewayJoinState {
  return {
    gatewayId: 'gw-1',
    instanceId: 'inst-1',
    activationId: 'act-1',
    arrivedFromFlows: ['flow-a'],
    expectedFlows: ['flow-a', 'flow-b'],
    ...overrides,
  } as GatewayJoinState
}

function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'hist-1',
    instanceId: 'inst-1',
    tokenId: 'tok-1',
    elementId: 'task-1',
    elementType: 'serviceTask',
    status: 'completed',
    startedAt: new Date('2024-01-01T00:00:00.000Z'),
    completedAt: new Date('2024-01-01T01:00:00.000Z'),
    ...overrides,
  }
}

function makeTimer(overrides: Partial<ScheduledTimer> = {}): ScheduledTimer {
  return {
    id: 'timer-1',
    instanceId: 'inst-1',
    tokenId: 'tok-1',
    fireAt: new Date('2024-01-01T00:00:00.000Z'),
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)('PostgresStateStore', () => {
  let store: PostgresStateStore
  let cleanupSql: ReturnType<typeof postgres>

  beforeAll(async () => {
    store = new PostgresStateStore(TEST_DB_URL)
    cleanupSql = postgres(TEST_DB_URL)
    await runMigrations(TEST_DB_URL)
  })

  afterAll(async () => {
    await store.close()
    await cleanupSql.end()
  })

  beforeEach(async () => {
    await cleanupSql`
      TRUNCATE
        definitions,
        instances,
        tokens,
        variable_scopes,
        user_tasks,
        event_subscriptions,
        gateway_join_states,
        history_entries,
        scheduled_timers
      CASCADE
    `
  })

  // ─── Process Definitions ──────────────────────────────────────────────────

  describe('definitions', () => {
    it('saveDefinition + getDefinition by id returns latest version', async () => {
      const def = makeDefinition()
      await store.saveDefinition(def)
      const retrieved = await store.getDefinition(def.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(def.id)
      expect(retrieved!.version).toBe(def.version)
      expect(retrieved!.name).toBe(def.name)
    })

    it('getDefinition by id + version returns exact match', async () => {
      const v1 = makeDefinition({ id: 'proc-1', version: 1, name: 'v1' })
      const v2 = makeDefinition({ id: 'proc-1', version: 2, name: 'v2' })
      await store.saveDefinition(v1)
      await store.saveDefinition(v2)
      const retrieved = await store.getDefinition('proc-1', 1)
      expect(retrieved!.version).toBe(1)
      expect(retrieved!.name).toBe('v1')
    })

    it('getDefinition returns null for unknown id', async () => {
      const result = await store.getDefinition('nonexistent')
      expect(result).toBeNull()
    })

    it('getDefinition without version returns latest when multiple versions exist', async () => {
      const v1 = makeDefinition({ id: 'proc-1', version: 1 })
      const v2 = makeDefinition({ id: 'proc-1', version: 2 })
      const v3 = makeDefinition({ id: 'proc-1', version: 3 })
      // Save out of order to ensure it picks max, not insertion order
      await store.saveDefinition(v1)
      await store.saveDefinition(v3)
      await store.saveDefinition(v2)
      const retrieved = await store.getDefinition('proc-1')
      expect(retrieved!.version).toBe(3)
    })

    it('listDefinitions returns all definitions', async () => {
      await store.saveDefinition(makeDefinition({ id: 'def-a', version: 1 }))
      await store.saveDefinition(makeDefinition({ id: 'def-b', version: 1 }))
      const list = await store.listDefinitions()
      expect(list.length).toBeGreaterThanOrEqual(2)
      const ids = list.map(d => d.id)
      expect(ids).toContain('def-a')
      expect(ids).toContain('def-b')
    })

    it('listDefinitions filters by isDeployable: true', async () => {
      await store.saveDefinition(makeDefinition({ id: 'deployable-1', isDeployable: true }))
      await store.saveDefinition(makeDefinition({ id: 'not-deployable-1', version: 1, isDeployable: false }))
      const list = await store.listDefinitions({ isDeployable: true })
      expect(list.every(d => d.isDeployable === true)).toBe(true)
      expect(list.some(d => d.id === 'deployable-1')).toBe(true)
      expect(list.some(d => d.id === 'not-deployable-1')).toBe(false)
    })

    it('listDefinitions filters by isDeployable: false', async () => {
      await store.saveDefinition(makeDefinition({ id: 'deployable-2', isDeployable: true }))
      await store.saveDefinition(makeDefinition({ id: 'not-deployable-2', version: 1, isDeployable: false }))
      const list = await store.listDefinitions({ isDeployable: false })
      expect(list.every(d => d.isDeployable === false)).toBe(true)
      expect(list.some(d => d.id === 'not-deployable-2')).toBe(true)
      expect(list.some(d => d.id === 'deployable-2')).toBe(false)
    })

    it('definition deployedAt round-trips as a Date', async () => {
      const def = makeDefinition({ deployedAt: new Date('2024-06-15T12:30:00.000Z') })
      await store.saveDefinition(def)
      const retrieved = await store.getDefinition(def.id)
      expect(retrieved!.deployedAt).toBeInstanceOf(Date)
      expect(retrieved!.deployedAt.toISOString()).toBe(def.deployedAt.toISOString())
    })

    it('saveDefinition upserts on same id+version', async () => {
      const def = makeDefinition()
      await store.saveDefinition(def)
      const updated = { ...def, name: 'Updated Name' }
      await store.saveDefinition(updated)
      const retrieved = await store.getDefinition(def.id, def.version)
      expect(retrieved!.name).toBe('Updated Name')
    })
  })

  // ─── Process Instances ────────────────────────────────────────────────────

  describe('instances', () => {
    it('createInstance + getInstance round-trips all fields including Dates', async () => {
      const inst = makeInstance({
        correlationKey: 'corr-123',
        businessKey: 'biz-456',
        startedAt: new Date('2024-03-01T08:00:00.000Z'),
      })
      await store.createInstance(inst)
      const retrieved = await store.getInstance(inst.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(inst.id)
      expect(retrieved!.definitionId).toBe(inst.definitionId)
      expect(retrieved!.definitionVersion).toBe(inst.definitionVersion)
      expect(retrieved!.status).toBe(inst.status)
      expect(retrieved!.rootScopeId).toBe(inst.rootScopeId)
      expect(retrieved!.correlationKey).toBe(inst.correlationKey)
      expect(retrieved!.businessKey).toBe(inst.businessKey)
      expect(retrieved!.startedAt).toBeInstanceOf(Date)
      expect(retrieved!.startedAt.toISOString()).toBe(inst.startedAt.toISOString())
    })

    it('getInstance returns null for unknown id', async () => {
      expect(await store.getInstance('nonexistent')).toBeNull()
    })

    it('updateInstance changes status and persists optional fields', async () => {
      const inst = makeInstance()
      await store.createInstance(inst)
      const completedAt = new Date('2024-01-02T00:00:00.000Z')
      const updated = { ...inst, status: 'completed' as const, completedAt }
      await store.updateInstance(updated)
      const retrieved = await store.getInstance(inst.id)
      expect(retrieved!.status).toBe('completed')
      expect(retrieved!.completedAt).toBeInstanceOf(Date)
      expect(retrieved!.completedAt!.toISOString()).toBe(completedAt.toISOString())
    })

    it('updateInstance persists errorInfo', async () => {
      const inst = makeInstance()
      await store.createInstance(inst)
      const errorInfo = { code: 'ERR_TIMEOUT', message: 'Service timed out', elementId: 'task-1', tokenId: 'tok-1' }
      await store.updateInstance({ ...inst, status: 'suspended', errorInfo })
      const retrieved = await store.getInstance(inst.id)
      expect(retrieved!.errorInfo).toEqual(errorInfo)
    })

    it('findInstances with no filters returns paginated results', async () => {
      await store.createInstance(makeInstance({ id: 'inst-a' }))
      await store.createInstance(makeInstance({ id: 'inst-b' }))
      const result = await store.findInstances({ page: 0, pageSize: 10 })
      expect(result.total).toBeGreaterThanOrEqual(2)
      expect(result.page).toBe(0)
      expect(result.pageSize).toBe(10)
      expect(result.items.length).toBeGreaterThanOrEqual(2)
    })

    it('findInstances filters by definitionId', async () => {
      await store.createInstance(makeInstance({ id: 'inst-1', definitionId: 'def-x' }))
      await store.createInstance(makeInstance({ id: 'inst-2', definitionId: 'def-y' }))
      const result = await store.findInstances({ definitionId: 'def-x', page: 0, pageSize: 10 })
      expect(result.items.every(i => i.definitionId === 'def-x')).toBe(true)
      expect(result.items.some(i => i.id === 'inst-1')).toBe(true)
      expect(result.items.some(i => i.id === 'inst-2')).toBe(false)
    })

    it('findInstances filters by status (single value)', async () => {
      await store.createInstance(makeInstance({ id: 'inst-active', status: 'active' }))
      await store.createInstance(makeInstance({ id: 'inst-completed', status: 'completed' }))
      const result = await store.findInstances({ status: 'active', page: 0, pageSize: 10 })
      expect(result.items.every(i => i.status === 'active')).toBe(true)
      expect(result.items.some(i => i.id === 'inst-active')).toBe(true)
      expect(result.items.some(i => i.id === 'inst-completed')).toBe(false)
    })

    it('findInstances filters by status (array)', async () => {
      await store.createInstance(makeInstance({ id: 'inst-active', status: 'active' }))
      await store.createInstance(makeInstance({ id: 'inst-suspended', status: 'suspended' }))
      await store.createInstance(makeInstance({ id: 'inst-completed', status: 'completed' }))
      const result = await store.findInstances({ status: ['active', 'suspended'], page: 0, pageSize: 10 })
      const ids = result.items.map(i => i.id)
      expect(ids).toContain('inst-active')
      expect(ids).toContain('inst-suspended')
      expect(ids).not.toContain('inst-completed')
    })

    it('findInstances filters by correlationKey', async () => {
      await store.createInstance(makeInstance({ id: 'inst-1', correlationKey: 'order-123' }))
      await store.createInstance(makeInstance({ id: 'inst-2', correlationKey: 'order-456' }))
      const result = await store.findInstances({ correlationKey: 'order-123', page: 0, pageSize: 10 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.id).toBe('inst-1')
    })

    it('findInstances filters by businessKey', async () => {
      await store.createInstance(makeInstance({ id: 'inst-1', businessKey: 'BIZ-001' }))
      await store.createInstance(makeInstance({ id: 'inst-2', businessKey: 'BIZ-002' }))
      const result = await store.findInstances({ businessKey: 'BIZ-001', page: 0, pageSize: 10 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.id).toBe('inst-1')
    })

    it('findInstances filters by startedAfter', async () => {
      await store.createInstance(makeInstance({ id: 'inst-old', startedAt: new Date('2024-01-01T00:00:00.000Z') }))
      await store.createInstance(makeInstance({ id: 'inst-new', startedAt: new Date('2024-06-01T00:00:00.000Z') }))
      const result = await store.findInstances({
        startedAfter: new Date('2024-03-01T00:00:00.000Z'),
        page: 0,
        pageSize: 10,
      })
      const ids = result.items.map(i => i.id)
      expect(ids).toContain('inst-new')
      expect(ids).not.toContain('inst-old')
    })

    it('findInstances filters by startedBefore', async () => {
      await store.createInstance(makeInstance({ id: 'inst-old', startedAt: new Date('2024-01-01T00:00:00.000Z') }))
      await store.createInstance(makeInstance({ id: 'inst-new', startedAt: new Date('2024-06-01T00:00:00.000Z') }))
      const result = await store.findInstances({
        startedBefore: new Date('2024-03-01T00:00:00.000Z'),
        page: 0,
        pageSize: 10,
      })
      const ids = result.items.map(i => i.id)
      expect(ids).toContain('inst-old')
      expect(ids).not.toContain('inst-new')
    })

    it('findInstances paginates correctly across pages', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createInstance(makeInstance({ id: `inst-pag-${i}` }))
      }
      const page0 = await store.findInstances({ page: 0, pageSize: 2 })
      const page1 = await store.findInstances({ page: 1, pageSize: 2 })
      const page2 = await store.findInstances({ page: 2, pageSize: 2 })
      expect(page0.items).toHaveLength(2)
      expect(page1.items).toHaveLength(2)
      expect(page2.items).toHaveLength(1)
      expect(page0.total).toBe(5)
      expect(page0.page).toBe(0)
      expect(page1.page).toBe(1)
      // All items across pages are distinct
      const allIds = [...page0.items, ...page1.items, ...page2.items].map(i => i.id)
      expect(new Set(allIds).size).toBe(5)
    })

    it('findInstances summary includes required fields', async () => {
      const inst = makeInstance({ correlationKey: 'ck-1', businessKey: 'bk-1' })
      await store.createInstance(inst)
      const result = await store.findInstances({ page: 0, pageSize: 10 })
      const summary = result.items.find(i => i.id === inst.id)!
      expect(summary.id).toBe(inst.id)
      expect(summary.definitionId).toBe(inst.definitionId)
      expect(summary.definitionVersion).toBe(inst.definitionVersion)
      expect(summary.status).toBe(inst.status)
      expect(summary.correlationKey).toBe(inst.correlationKey)
      expect(summary.businessKey).toBe(inst.businessKey)
      expect(summary.startedAt).toBeInstanceOf(Date)
    })
  })

  // ─── Tokens ───────────────────────────────────────────────────────────────

  describe('tokens', () => {
    it('saveTokens (create) + getAllTokens round-trips all fields', async () => {
      const token = makeToken({
        arrivedViaFlowId: 'flow-1',
        parentTokenId: 'parent-tok',
        waitingFor: { type: 'message', correlationData: { orderId: 'o-1' } },
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      })
      await store.saveTokens([token])
      const all = await store.getAllTokens(token.instanceId)
      expect(all).toHaveLength(1)
      const retrieved = all[0]!
      expect(retrieved.id).toBe(token.id)
      expect(retrieved.instanceId).toBe(token.instanceId)
      expect(retrieved.elementId).toBe(token.elementId)
      expect(retrieved.elementType).toBe(token.elementType)
      expect(retrieved.status).toBe(token.status)
      expect(retrieved.scopeId).toBe(token.scopeId)
      expect(retrieved.arrivedViaFlowId).toBe(token.arrivedViaFlowId)
      expect(retrieved.parentTokenId).toBe(token.parentTokenId)
      expect(retrieved.waitingFor).toEqual(token.waitingFor)
      expect(retrieved.createdAt).toBeInstanceOf(Date)
      expect(retrieved.createdAt.toISOString()).toBe(token.createdAt.toISOString())
      expect(retrieved.updatedAt).toBeInstanceOf(Date)
      expect(retrieved.updatedAt.toISOString()).toBe(token.updatedAt.toISOString())
    })

    it('saveTokens upserts existing token (updates in place)', async () => {
      const token = makeToken({ status: 'active' })
      await store.saveTokens([token])
      await store.saveTokens([{ ...token, status: 'waiting' }])
      const all = await store.getAllTokens(token.instanceId)
      expect(all).toHaveLength(1)
      expect(all[0]!.status).toBe('waiting')
    })

    it('getActiveTokens returns active, waiting, and suspended tokens', async () => {
      await store.saveTokens([
        makeToken({ id: 'tok-active', status: 'active' }),
        makeToken({ id: 'tok-waiting', status: 'waiting' }),
        makeToken({ id: 'tok-suspended', status: 'suspended' }),
        makeToken({ id: 'tok-cancelled', status: 'cancelled' }),
        makeToken({ id: 'tok-completed', status: 'completed' }),
      ])
      const active = await store.getActiveTokens('inst-1')
      const ids = active.map(t => t.id).sort()
      expect(ids).toEqual(['tok-active', 'tok-suspended', 'tok-waiting'])
    })

    it('getActiveTokens does not return cancelled or completed tokens', async () => {
      await store.saveTokens([
        makeToken({ id: 'tok-cancelled', status: 'cancelled' }),
        makeToken({ id: 'tok-completed', status: 'completed' }),
      ])
      const active = await store.getActiveTokens('inst-1')
      expect(active).toHaveLength(0)
    })

    it('getAllTokens returns all statuses', async () => {
      await store.saveTokens([
        makeToken({ id: 'tok-1', status: 'active' }),
        makeToken({ id: 'tok-2', status: 'cancelled' }),
        makeToken({ id: 'tok-3', status: 'completed' }),
      ])
      const all = await store.getAllTokens('inst-1')
      expect(all).toHaveLength(3)
    })

    it('tokens are isolated by instanceId', async () => {
      await store.saveTokens([makeToken({ id: 'tok-a', instanceId: 'inst-a' })])
      await store.saveTokens([makeToken({ id: 'tok-b', instanceId: 'inst-b' })])
      const forA = await store.getAllTokens('inst-a')
      const forB = await store.getAllTokens('inst-b')
      expect(forA).toHaveLength(1)
      expect(forA[0]!.id).toBe('tok-a')
      expect(forB).toHaveLength(1)
      expect(forB[0]!.id).toBe('tok-b')
    })

    it('saveTokens handles multiple tokens in one call', async () => {
      const tokens = [
        makeToken({ id: 'tok-1', status: 'active' }),
        makeToken({ id: 'tok-2', status: 'active' }),
        makeToken({ id: 'tok-3', status: 'active' }),
      ]
      await store.saveTokens(tokens)
      const all = await store.getAllTokens('inst-1')
      expect(all).toHaveLength(3)
    })
  })

  // ─── Variable Scopes ──────────────────────────────────────────────────────

  describe('variable scopes', () => {
    it('saveScope + getScope round-trips all fields', async () => {
      const scope = makeScope({
        id: 'scope-1',
        variables: {
          name: { type: 'string', value: 'Alice' },
          age: { type: 'number', value: 30 },
          active: { type: 'boolean', value: true },
          tags: { type: 'array', value: ['a', 'b'] },
          meta: { type: 'object', value: { key: 'val' } },
          nothing: { type: 'null', value: null },
        },
      })
      await store.saveScope(scope)
      const retrieved = await store.getScope(scope.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved).toEqual(scope)
    })

    it('getScope returns null for unknown id', async () => {
      expect(await store.getScope('nonexistent')).toBeNull()
    })

    it('saveScope upserts on same id', async () => {
      const scope = makeScope({ variables: { x: { type: 'number', value: 1 } } })
      await store.saveScope(scope)
      await store.saveScope({ ...scope, variables: { x: { type: 'number', value: 99 } } })
      const retrieved = await store.getScope(scope.id)
      expect(retrieved!.variables['x']!.value).toBe(99)
    })

    it('getScopeChain for single scope with no parent returns [scope]', async () => {
      const scope = makeScope({ id: 'root-scope' })
      await store.saveScope(scope)
      const chain = await store.getScopeChain('root-scope')
      expect(chain).toHaveLength(1)
      expect(chain[0]!.id).toBe('root-scope')
    })

    it('getScopeChain returns chain of 3 scopes from leaf to root', async () => {
      const grandparent = makeScope({ id: 'grandparent', variables: { env: { type: 'string', value: 'prod' } } })
      const parent = makeScope({ id: 'parent', parentScopeId: 'grandparent', variables: {} })
      const leaf = makeScope({ id: 'leaf', parentScopeId: 'parent', variables: {} })
      await store.saveScope(grandparent)
      await store.saveScope(parent)
      await store.saveScope(leaf)
      const chain = await store.getScopeChain('leaf')
      expect(chain.map(s => s.id)).toEqual(['leaf', 'parent', 'grandparent'])
    })
  })

  // ─── User Tasks ───────────────────────────────────────────────────────────

  describe('user tasks', () => {
    it('createUserTask + getUserTask round-trips all fields', async () => {
      const task = makeUserTask({
        description: 'Please review this document',
        assignee: 'alice',
        candidateGroups: ['reviewers', 'managers'],
        dueDate: new Date('2024-02-01T00:00:00.000Z'),
        priority: 80,
        inputVariables: { doc: { type: 'string', value: 'doc-abc' } },
        formKey: 'review-form',
        status: 'claimed',
        claimedAt: new Date('2024-01-01T02:00:00.000Z'),
      })
      await store.createUserTask(task)
      const retrieved = await store.getUserTask(task.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(task.id)
      expect(retrieved!.instanceId).toBe(task.instanceId)
      expect(retrieved!.tokenId).toBe(task.tokenId)
      expect(retrieved!.elementId).toBe(task.elementId)
      expect(retrieved!.name).toBe(task.name)
      expect(retrieved!.description).toBe(task.description)
      expect(retrieved!.assignee).toBe(task.assignee)
      expect(retrieved!.candidateGroups).toEqual(task.candidateGroups)
      expect(retrieved!.dueDate).toBeInstanceOf(Date)
      expect(retrieved!.dueDate!.toISOString()).toBe(task.dueDate!.toISOString())
      expect(retrieved!.priority).toBe(task.priority)
      expect(retrieved!.inputVariables).toEqual(task.inputVariables)
      expect(retrieved!.formKey).toBe(task.formKey)
      expect(retrieved!.status).toBe(task.status)
      expect(retrieved!.createdAt).toBeInstanceOf(Date)
      expect(retrieved!.createdAt.toISOString()).toBe(task.createdAt.toISOString())
      expect(retrieved!.claimedAt).toBeInstanceOf(Date)
      expect(retrieved!.claimedAt!.toISOString()).toBe(task.claimedAt!.toISOString())
    })

    it('getUserTask returns null for unknown id', async () => {
      expect(await store.getUserTask('nonexistent')).toBeNull()
    })

    it('updateUserTask changes status and assignee', async () => {
      const task = makeUserTask({ status: 'open' })
      await store.createUserTask(task)
      const completedAt = new Date('2024-01-01T03:00:00.000Z')
      await store.updateUserTask({ ...task, status: 'completed', assignee: 'bob', completedAt })
      const retrieved = await store.getUserTask(task.id)
      expect(retrieved!.status).toBe('completed')
      expect(retrieved!.assignee).toBe('bob')
      expect(retrieved!.completedAt).toBeInstanceOf(Date)
      expect(retrieved!.completedAt!.toISOString()).toBe(completedAt.toISOString())
    })

    it('queryUserTasks by instanceId', async () => {
      await store.createUserTask(makeUserTask({ id: 'task-1', instanceId: 'inst-a' }))
      await store.createUserTask(makeUserTask({ id: 'task-2', instanceId: 'inst-b' }))
      const result = await store.queryUserTasks({ instanceId: 'inst-a', page: 0, pageSize: 10 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.id).toBe('task-1')
    })

    it('queryUserTasks by assignee', async () => {
      await store.createUserTask(makeUserTask({ id: 'task-1', assignee: 'alice' }))
      await store.createUserTask(makeUserTask({ id: 'task-2', assignee: 'bob' }))
      const result = await store.queryUserTasks({ assignee: 'alice', page: 0, pageSize: 10 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.id).toBe('task-1')
    })

    it('queryUserTasks by candidateGroup (array contains)', async () => {
      await store.createUserTask(makeUserTask({ id: 'task-1', candidateGroups: ['reviewers', 'managers'] }))
      await store.createUserTask(makeUserTask({ id: 'task-2', candidateGroups: ['developers'] }))
      const result = await store.queryUserTasks({ candidateGroup: 'reviewers', page: 0, pageSize: 10 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.id).toBe('task-1')
    })

    it('queryUserTasks by status (single value)', async () => {
      await store.createUserTask(makeUserTask({ id: 'task-open', status: 'open' }))
      await store.createUserTask(makeUserTask({ id: 'task-claimed', status: 'claimed' }))
      const result = await store.queryUserTasks({ status: 'open', page: 0, pageSize: 10 })
      expect(result.items.every(t => t.status === 'open')).toBe(true)
      expect(result.items.some(t => t.id === 'task-open')).toBe(true)
      expect(result.items.some(t => t.id === 'task-claimed')).toBe(false)
    })

    it('queryUserTasks by status (array)', async () => {
      await store.createUserTask(makeUserTask({ id: 'task-open', status: 'open' }))
      await store.createUserTask(makeUserTask({ id: 'task-claimed', status: 'claimed' }))
      await store.createUserTask(makeUserTask({ id: 'task-completed', status: 'completed' }))
      const result = await store.queryUserTasks({ status: ['open', 'claimed'], page: 0, pageSize: 10 })
      const ids = result.items.map(t => t.id)
      expect(ids).toContain('task-open')
      expect(ids).toContain('task-claimed')
      expect(ids).not.toContain('task-completed')
    })

    it('queryUserTasks paginates results', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createUserTask(makeUserTask({ id: `task-${i}` }))
      }
      const page0 = await store.queryUserTasks({ page: 0, pageSize: 2 })
      const page1 = await store.queryUserTasks({ page: 1, pageSize: 2 })
      const page2 = await store.queryUserTasks({ page: 2, pageSize: 2 })
      expect(page0.items).toHaveLength(2)
      expect(page1.items).toHaveLength(2)
      expect(page2.items).toHaveLength(1)
      expect(page0.total).toBe(5)
    })
  })

  // ─── Event Subscriptions ──────────────────────────────────────────────────

  describe('event subscriptions', () => {
    it('saveSubscription + findSubscriptions round-trips all fields', async () => {
      const sub = makeSubscription({
        type: 'message',
        messageName: 'order.approved',
        correlationValue: 'order-123',
        status: 'active',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      })
      await store.saveSubscription(sub)
      const found = await store.findSubscriptions({ messageName: 'order.approved' })
      expect(found).toHaveLength(1)
      const retrieved = found[0]!
      expect(retrieved.id).toBe(sub.id)
      expect(retrieved.instanceId).toBe(sub.instanceId)
      expect(retrieved.tokenId).toBe(sub.tokenId)
      expect(retrieved.type).toBe(sub.type)
      expect(retrieved.messageName).toBe(sub.messageName)
      expect(retrieved.correlationValue).toBe(sub.correlationValue)
      expect(retrieved.status).toBe(sub.status)
      expect(retrieved.createdAt).toBeInstanceOf(Date)
      expect(retrieved.createdAt.toISOString()).toBe(sub.createdAt.toISOString())
    })

    it('deleteSubscription removes subscription from findSubscriptions', async () => {
      const sub = makeSubscription()
      await store.saveSubscription(sub)
      await store.deleteSubscription(sub.id)
      const found = await store.findSubscriptions({ messageName: sub.messageName! })
      expect(found).toHaveLength(0)
    })

    it('findSubscriptions only returns active subscriptions, not resolved or cancelled', async () => {
      await store.saveSubscription(makeSubscription({ id: 'sub-active', status: 'active' }))
      await store.saveSubscription(makeSubscription({ id: 'sub-resolved', status: 'resolved' }))
      await store.saveSubscription(makeSubscription({ id: 'sub-cancelled', status: 'cancelled' }))
      const found = await store.findSubscriptions({ messageName: 'order.approved' })
      expect(found).toHaveLength(1)
      expect(found[0]!.id).toBe('sub-active')
    })

    it('findSubscriptions filters by type', async () => {
      await store.saveSubscription(makeSubscription({ id: 'sub-msg', type: 'message' }))
      await store.saveSubscription(makeSubscription({ id: 'sub-sig', type: 'signal', signalName: 'my-signal' }))
      const found = await store.findSubscriptions({ type: 'signal' })
      expect(found).toHaveLength(1)
      expect(found[0]!.id).toBe('sub-sig')
    })

    it('findSubscriptions filters by messageName', async () => {
      await store.saveSubscription(makeSubscription({ id: 'sub-1', messageName: 'order.approved' }))
      await store.saveSubscription(makeSubscription({ id: 'sub-2', messageName: 'order.rejected' }))
      const found = await store.findSubscriptions({ messageName: 'order.approved' })
      expect(found).toHaveLength(1)
      expect(found[0]!.id).toBe('sub-1')
    })

    it('findSubscriptions filters by signalName', async () => {
      await store.saveSubscription(makeSubscription({ id: 'sub-1', type: 'signal', signalName: 'signal-a' }))
      await store.saveSubscription(makeSubscription({ id: 'sub-2', type: 'signal', signalName: 'signal-b' }))
      const found = await store.findSubscriptions({ signalName: 'signal-a' })
      expect(found).toHaveLength(1)
      expect(found[0]!.id).toBe('sub-1')
    })

    it('findSubscriptions filters by correlationValue', async () => {
      await store.saveSubscription(makeSubscription({ id: 'sub-1', correlationValue: 'order-123' }))
      await store.saveSubscription(makeSubscription({ id: 'sub-2', correlationValue: 'order-456' }))
      const found = await store.findSubscriptions({ correlationValue: 'order-123' })
      expect(found).toHaveLength(1)
      expect(found[0]!.id).toBe('sub-1')
    })

    it('findSubscriptions filters by instanceId', async () => {
      await store.saveSubscription(makeSubscription({ id: 'sub-1', instanceId: 'inst-a' }))
      await store.saveSubscription(makeSubscription({ id: 'sub-2', instanceId: 'inst-b' }))
      const found = await store.findSubscriptions({ instanceId: 'inst-a' })
      expect(found).toHaveLength(1)
      expect(found[0]!.id).toBe('sub-1')
    })

    it('saveSubscription with signal type round-trips signalName', async () => {
      const sub = makeSubscription({ id: 'sub-sig', type: 'signal', signalName: 'process-approved' })
      await store.saveSubscription(sub)
      const found = await store.findSubscriptions({ type: 'signal', signalName: 'process-approved' })
      expect(found).toHaveLength(1)
      expect(found[0]!.signalName).toBe('process-approved')
    })

    it('saveSubscription with error type round-trips errorCode', async () => {
      const sub = makeSubscription({ id: 'sub-err', type: 'error', errorCode: 'ERR_PAYMENT' })
      await store.saveSubscription(sub)
      const found = await store.findSubscriptions({ type: 'error' })
      expect(found).toHaveLength(1)
      expect(found[0]!.errorCode).toBe('ERR_PAYMENT')
    })
  })

  // ─── Gateway Join States ──────────────────────────────────────────────────

  describe('gateway join states', () => {
    it('saveGatewayState + getGatewayState for parallel gateway (has expectedFlows)', async () => {
      const state: GatewayJoinState = {
        gatewayId: 'gw-parallel',
        instanceId: 'inst-1',
        activationId: 'act-1',
        arrivedFromFlows: ['flow-a', 'flow-b'],
        expectedFlows: ['flow-a', 'flow-b', 'flow-c'],
      }
      await store.saveGatewayState(state)
      const retrieved = await store.getGatewayState('gw-parallel', 'inst-1')
      expect(retrieved).not.toBeNull()
      expect(retrieved).toEqual(state)
    })

    it('saveGatewayState + getGatewayState for inclusive gateway (has activatedIncomingFlows)', async () => {
      const state: GatewayJoinState = {
        gatewayId: 'gw-inclusive',
        instanceId: 'inst-1',
        activationId: 'act-2',
        activatedIncomingFlows: ['flow-a', 'flow-b'],
        arrivedFromFlows: ['flow-a'],
      }
      await store.saveGatewayState(state)
      const retrieved = await store.getGatewayState('gw-inclusive', 'inst-1')
      expect(retrieved).not.toBeNull()
      expect(retrieved).toEqual(state)
    })

    it('getGatewayState returns null for unknown gateway', async () => {
      expect(await store.getGatewayState('gw-unknown', 'inst-1')).toBeNull()
    })

    it('deleteGatewayState causes getGatewayState to return null', async () => {
      const state = makeParallelGatewayState()
      await store.saveGatewayState(state)
      await store.deleteGatewayState(state.gatewayId, state.instanceId)
      expect(await store.getGatewayState(state.gatewayId, state.instanceId)).toBeNull()
    })

    it('two gateways with same instanceId are independent', async () => {
      await store.saveGatewayState(makeParallelGatewayState({ gatewayId: 'gw-1', instanceId: 'inst-1', activationId: 'act-a' }))
      await store.saveGatewayState(makeParallelGatewayState({ gatewayId: 'gw-2', instanceId: 'inst-1', activationId: 'act-b' }))
      const state1 = await store.getGatewayState('gw-1', 'inst-1')
      const state2 = await store.getGatewayState('gw-2', 'inst-1')
      expect(state1!.activationId).toBe('act-a')
      expect(state2!.activationId).toBe('act-b')
    })

    it('saveGatewayState upserts on same gatewayId + instanceId', async () => {
      const state = makeParallelGatewayState({ arrivedFromFlows: ['flow-a'] })
      await store.saveGatewayState(state)
      await store.saveGatewayState({ ...state, arrivedFromFlows: ['flow-a', 'flow-b'] })
      const retrieved = await store.getGatewayState(state.gatewayId, state.instanceId)
      expect(retrieved!.arrivedFromFlows).toEqual(['flow-a', 'flow-b'])
    })
  })

  // ─── History ──────────────────────────────────────────────────────────────

  describe('history', () => {
    it('appendHistory + getHistory round-trips all fields', async () => {
      const entry = makeHistoryEntry({
        variablesSnapshot: { result: { type: 'string', value: 'approved' } },
      })
      await store.appendHistory(entry)
      const history = await store.getHistory(entry.instanceId)
      expect(history).toHaveLength(1)
      const retrieved = history[0]!
      expect(retrieved.id).toBe(entry.id)
      expect(retrieved.instanceId).toBe(entry.instanceId)
      expect(retrieved.tokenId).toBe(entry.tokenId)
      expect(retrieved.elementId).toBe(entry.elementId)
      expect(retrieved.elementType).toBe(entry.elementType)
      expect(retrieved.status).toBe(entry.status)
      expect(retrieved.variablesSnapshot).toEqual(entry.variablesSnapshot)
      expect(retrieved.startedAt).toBeInstanceOf(Date)
      expect(retrieved.startedAt.toISOString()).toBe(entry.startedAt.toISOString())
      expect(retrieved.completedAt).toBeInstanceOf(Date)
      expect(retrieved.completedAt.toISOString()).toBe(entry.completedAt.toISOString())
    })

    it('multiple entries for same instance are all returned', async () => {
      await store.appendHistory(makeHistoryEntry({ id: 'hist-1', elementId: 'start-1', startedAt: new Date('2024-01-01T00:00:00.000Z'), completedAt: new Date('2024-01-01T00:01:00.000Z') }))
      await store.appendHistory(makeHistoryEntry({ id: 'hist-2', elementId: 'task-1', startedAt: new Date('2024-01-01T00:01:00.000Z'), completedAt: new Date('2024-01-01T00:05:00.000Z') }))
      await store.appendHistory(makeHistoryEntry({ id: 'hist-3', elementId: 'end-1', startedAt: new Date('2024-01-01T00:05:00.000Z'), completedAt: new Date('2024-01-01T00:05:01.000Z') }))
      const history = await store.getHistory('inst-1')
      expect(history).toHaveLength(3)
      const ids = history.map(h => h.id)
      expect(ids).toContain('hist-1')
      expect(ids).toContain('hist-2')
      expect(ids).toContain('hist-3')
    })

    it('getHistory returns empty array for unknown instance', async () => {
      const history = await store.getHistory('inst-nonexistent')
      expect(history).toEqual([])
    })

    it('history entries are isolated by instanceId', async () => {
      await store.appendHistory(makeHistoryEntry({ id: 'hist-a', instanceId: 'inst-a' }))
      await store.appendHistory(makeHistoryEntry({ id: 'hist-b', instanceId: 'inst-b' }))
      expect(await store.getHistory('inst-a')).toHaveLength(1)
      expect(await store.getHistory('inst-b')).toHaveLength(1)
    })
  })

  // ─── Timers ───────────────────────────────────────────────────────────────

  describe('timers', () => {
    it('saveTimer + getDueTimers returns timer that is due', async () => {
      const pastDate = new Date(Date.now() - 60_000) // 1 minute ago
      const timer = makeTimer({ fireAt: pastDate })
      await store.saveTimer(timer)
      const due = await store.getDueTimers(new Date())
      expect(due.some(t => t.id === timer.id)).toBe(true)
    })

    it('getDueTimers does not return timers not yet due', async () => {
      const futureDate = new Date(Date.now() + 60_000) // 1 minute in the future
      const timer = makeTimer({ id: 'timer-future', fireAt: futureDate })
      await store.saveTimer(timer)
      const due = await store.getDueTimers(new Date())
      expect(due.some(t => t.id === timer.id)).toBe(false)
    })

    it('deleteTimer removes it from getDueTimers', async () => {
      const pastDate = new Date(Date.now() - 60_000)
      const timer = makeTimer({ fireAt: pastDate })
      await store.saveTimer(timer)
      await store.deleteTimer(timer.id)
      const due = await store.getDueTimers(new Date())
      expect(due.some(t => t.id === timer.id)).toBe(false)
    })

    it('saveTimer + getDueTimers round-trips all fields', async () => {
      const pastDate = new Date(Date.now() - 1000)
      const timer = makeTimer({
        id: 'timer-fields',
        instanceId: 'inst-1',
        tokenId: 'tok-1',
        fireAt: pastDate,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      })
      await store.saveTimer(timer)
      const due = await store.getDueTimers(new Date())
      const retrieved = due.find(t => t.id === timer.id)!
      expect(retrieved).not.toBeUndefined()
      expect(retrieved.id).toBe(timer.id)
      expect(retrieved.instanceId).toBe(timer.instanceId)
      expect(retrieved.tokenId).toBe(timer.tokenId)
      expect(retrieved.fireAt).toBeInstanceOf(Date)
      expect(retrieved.createdAt).toBeInstanceOf(Date)
      expect(retrieved.createdAt.toISOString()).toBe(timer.createdAt.toISOString())
    })

    it('getDueTimers boundary: timer exactly at cutoff is included', async () => {
      const cutoff = new Date()
      const timer = makeTimer({ id: 'timer-boundary', fireAt: new Date(cutoff.getTime() - 1) })
      await store.saveTimer(timer)
      const due = await store.getDueTimers(cutoff)
      expect(due.some(t => t.id === timer.id)).toBe(true)
    })
  })

  // ─── executeTransaction ───────────────────────────────────────────────────

  describe('executeTransaction', () => {
    it('commits createInstance + saveTokens + saveScope atomically', async () => {
      const inst = makeInstance({ id: 'txn-inst-1', rootScopeId: 'txn-scope-1' })
      const token = makeToken({ id: 'txn-tok-1', instanceId: 'txn-inst-1' })
      const scope = makeScope({ id: 'txn-scope-1' })

      await store.executeTransaction([
        { op: 'createInstance', instance: inst },
        { op: 'saveTokens', tokens: [token] },
        { op: 'saveScope', scope },
      ])

      expect(await store.getInstance(inst.id)).not.toBeNull()
      const tokens = await store.getActiveTokens(inst.id)
      expect(tokens).toHaveLength(1)
      expect(await store.getScope(scope.id)).not.toBeNull()
    })

    it('supports saveDefinition op', async () => {
      const def = makeDefinition({ id: 'txn-def-1' })
      await store.executeTransaction([{ op: 'saveDefinition', definition: def }])
      expect(await store.getDefinition(def.id)).not.toBeNull()
    })

    it('supports updateInstance op', async () => {
      const inst = makeInstance({ id: 'txn-upd-inst' })
      await store.createInstance(inst)
      await store.executeTransaction([
        { op: 'updateInstance', instance: { ...inst, status: 'completed' } },
      ])
      const retrieved = await store.getInstance(inst.id)
      expect(retrieved!.status).toBe('completed')
    })

    it('supports createUserTask + updateUserTask ops', async () => {
      const task = makeUserTask({ id: 'txn-task-1' })
      await store.executeTransaction([{ op: 'createUserTask', task }])
      expect(await store.getUserTask(task.id)).not.toBeNull()

      await store.executeTransaction([
        { op: 'updateUserTask', task: { ...task, status: 'claimed', assignee: 'alice' } },
      ])
      const retrieved = await store.getUserTask(task.id)
      expect(retrieved!.status).toBe('claimed')
    })

    it('supports saveSubscription + deleteSubscription ops', async () => {
      const sub = makeSubscription({ id: 'txn-sub-1' })
      await store.executeTransaction([{ op: 'saveSubscription', subscription: sub }])
      const found = await store.findSubscriptions({ messageName: sub.messageName! })
      expect(found).toHaveLength(1)

      await store.executeTransaction([{ op: 'deleteSubscription', id: sub.id }])
      const foundAfter = await store.findSubscriptions({ messageName: sub.messageName! })
      expect(foundAfter).toHaveLength(0)
    })

    it('supports saveGatewayState + deleteGatewayState ops', async () => {
      const state = makeParallelGatewayState({ gatewayId: 'txn-gw', instanceId: 'txn-inst' })
      await store.executeTransaction([{ op: 'saveGatewayState', state }])
      expect(await store.getGatewayState('txn-gw', 'txn-inst')).not.toBeNull()

      await store.executeTransaction([
        { op: 'deleteGatewayState', gatewayId: 'txn-gw', instanceId: 'txn-inst' },
      ])
      expect(await store.getGatewayState('txn-gw', 'txn-inst')).toBeNull()
    })

    it('supports appendHistory op', async () => {
      const entry = makeHistoryEntry({ id: 'txn-hist-1', instanceId: 'txn-hist-inst' })
      await store.executeTransaction([{ op: 'appendHistory', entry }])
      const history = await store.getHistory('txn-hist-inst')
      expect(history).toHaveLength(1)
    })

    it('supports saveTimer + deleteTimer ops', async () => {
      const timer = makeTimer({ id: 'txn-timer-1', fireAt: new Date(Date.now() - 1000) })
      await store.executeTransaction([{ op: 'saveTimer', timer }])
      const due = await store.getDueTimers(new Date())
      expect(due.some(t => t.id === timer.id)).toBe(true)

      await store.executeTransaction([{ op: 'deleteTimer', id: timer.id }])
      const dueAfter = await store.getDueTimers(new Date())
      expect(dueAfter.some(t => t.id === timer.id)).toBe(false)
    })

    it('all op types work together in a single transaction', async () => {
      const def = makeDefinition({ id: 'txn-all-def' })
      const inst = makeInstance({ id: 'txn-all-inst', definitionId: 'txn-all-def' })
      const scope = makeScope({ id: 'txn-all-scope' })
      const token = makeToken({ id: 'txn-all-tok', instanceId: 'txn-all-inst', scopeId: 'txn-all-scope' })
      const task = makeUserTask({ id: 'txn-all-task', instanceId: 'txn-all-inst', tokenId: 'txn-all-tok' })
      const sub = makeSubscription({ id: 'txn-all-sub', instanceId: 'txn-all-inst', tokenId: 'txn-all-tok' })
      const gwState = makeParallelGatewayState({ gatewayId: 'txn-all-gw', instanceId: 'txn-all-inst' })
      const histEntry = makeHistoryEntry({ id: 'txn-all-hist', instanceId: 'txn-all-inst', tokenId: 'txn-all-tok' })
      const timer = makeTimer({ id: 'txn-all-timer', instanceId: 'txn-all-inst', tokenId: 'txn-all-tok', fireAt: new Date(Date.now() - 1000) })

      await store.executeTransaction([
        { op: 'saveDefinition', definition: def },
        { op: 'createInstance', instance: inst },
        { op: 'saveScope', scope },
        { op: 'saveTokens', tokens: [token] },
        { op: 'createUserTask', task },
        { op: 'saveSubscription', subscription: sub },
        { op: 'saveGatewayState', state: gwState },
        { op: 'appendHistory', entry: histEntry },
        { op: 'saveTimer', timer },
      ])

      expect(await store.getDefinition(def.id)).not.toBeNull()
      expect(await store.getInstance(inst.id)).not.toBeNull()
      expect(await store.getScope(scope.id)).not.toBeNull()
      expect(await store.getActiveTokens(inst.id)).toHaveLength(1)
      expect(await store.getUserTask(task.id)).not.toBeNull()
      expect(await store.findSubscriptions({ messageName: sub.messageName! })).toHaveLength(1)
      expect(await store.getGatewayState(gwState.gatewayId, gwState.instanceId)).not.toBeNull()
      expect(await store.getHistory(inst.id)).toHaveLength(1)
      const due = await store.getDueTimers(new Date())
      expect(due.some(t => t.id === timer.id)).toBe(true)
    })
  })
})
