import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStateStore } from './InMemoryStateStore.js'
import { buildDefinition, buildSimpleSequenceDefinition } from '../../tests/fixtures/builders/ProcessDefinitionBuilder.js'
import { buildInstance } from '../../tests/fixtures/builders/ProcessInstanceBuilder.js'
import { buildToken } from '../../tests/fixtures/builders/TokenBuilder.js'
import type { VariableScope, EventSubscription } from '../model/types.js'

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
