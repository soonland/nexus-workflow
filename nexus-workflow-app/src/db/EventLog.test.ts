import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { ExecutionEvent } from 'nexus-workflow-core'
import { InMemoryEventLog, PostgresEventLog } from './EventLog.js'

// ─── InMemoryEventLog ────────────────────────────────────────────────────────

describe('InMemoryEventLog', () => {
  it('append then getForInstance returns appended event', async () => {
    const log = new InMemoryEventLog()
    const event: ExecutionEvent = {
      type: 'ProcessInstanceStarted',
      instanceId: 'inst-1',
      definitionId: 'def-1',
      definitionVersion: 1,
    }
    await log.append(event)
    const results = await log.getForInstance('inst-1')
    expect(results).toHaveLength(1)
    expect(results[0]!.instanceId).toBe('inst-1')
    expect(results[0]!.type).toBe('ProcessInstanceStarted')
    expect(results[0]!.data).toEqual(event)
  })

  it('assigns a unique string id to each stored event', async () => {
    const log = new InMemoryEventLog()
    const event: ExecutionEvent = {
      type: 'ProcessInstanceStarted',
      instanceId: 'inst-1',
      definitionId: 'def-1',
      definitionVersion: 1,
    }
    await log.append(event)
    await log.append(event)
    const results = await log.getForInstance('inst-1')
    expect(results).toHaveLength(2)
    expect(results[0]!.id).not.toBe(results[1]!.id)
  })

  it('getForInstance returns only events for the specified instance', async () => {
    const log = new InMemoryEventLog()
    const ev1: ExecutionEvent = {
      type: 'ProcessInstanceStarted',
      instanceId: 'inst-A',
      definitionId: 'def-1',
      definitionVersion: 1,
    }
    const ev2: ExecutionEvent = {
      type: 'ProcessInstanceStarted',
      instanceId: 'inst-B',
      definitionId: 'def-1',
      definitionVersion: 1,
    }
    await log.append(ev1)
    await log.append(ev2)
    const results = await log.getForInstance('inst-A')
    expect(results).toHaveLength(1)
    expect(results[0]!.instanceId).toBe('inst-A')
  })

  it('getForInstance returns empty array when instance has no events', async () => {
    const log = new InMemoryEventLog()
    const results = await log.getForInstance('no-such-instance')
    expect(results).toEqual([])
  })

  it('stores events with a numeric occurredAt Date', async () => {
    const log = new InMemoryEventLog()
    const before = new Date()
    await log.append({
      type: 'ProcessInstanceStarted',
      instanceId: 'inst-1',
      definitionId: 'def-1',
      definitionVersion: 1,
    })
    const after = new Date()
    const [ev] = await log.getForInstance('inst-1')
    expect(ev!.occurredAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(ev!.occurredAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('handles events without an instanceId (extractInstanceId returns null)', async () => {
    const log = new InMemoryEventLog()
    // ProcessDefinitionDeployed has no instanceId
    const event = {
      type: 'ProcessDefinitionDeployed',
      definitionId: 'def-1',
      version: 1,
    } as unknown as ExecutionEvent
    await log.append(event)
    // No instanceId, so getForInstance('anything') won't find it
    const results = await log.getForInstance('inst-X')
    expect(results).toHaveLength(0)
  })

  it('accumulates multiple events for the same instance in append order', async () => {
    const log = new InMemoryEventLog()
    const instanceId = 'inst-seq'
    await log.append({
      type: 'ProcessInstanceStarted',
      instanceId,
      definitionId: 'def-1',
      definitionVersion: 1,
    })
    await log.append({
      type: 'ProcessInstanceCompleted',
      instanceId,
    } as unknown as ExecutionEvent)
    const results = await log.getForInstance(instanceId)
    expect(results).toHaveLength(2)
    expect(results[0]!.type).toBe('ProcessInstanceStarted')
    expect(results[1]!.type).toBe('ProcessInstanceCompleted')
  })
})

// ─── PostgresEventLog ────────────────────────────────────────────────────────

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow_test'

describe('PostgresEventLog', () => {
  let log: PostgresEventLog

  beforeAll(() => {
    log = new PostgresEventLog(DATABASE_URL)
  })

  afterAll(async () => {
    // Clean up any test rows written during this suite
    // The test DB is shared — we prefix instanceIds to isolate
  })

  it('append stores an event and getForInstance retrieves it', async () => {
    const instanceId = `test-eventlog-${crypto.randomUUID()}`
    const event: ExecutionEvent = {
      type: 'ProcessInstanceStarted',
      instanceId,
      definitionId: 'def-postgres-1',
      definitionVersion: 1,
    }

    await log.append(event)
    const results = await log.getForInstance(instanceId)

    expect(results).toHaveLength(1)
    expect(results[0]!.instanceId).toBe(instanceId)
    expect(results[0]!.type).toBe('ProcessInstanceStarted')
  })

  it('returns empty array for an instance with no events', async () => {
    const instanceId = `test-eventlog-none-${crypto.randomUUID()}`
    const results = await log.getForInstance(instanceId)
    expect(results).toEqual([])
  })

  it('returns events in ascending occurredAt order', async () => {
    const instanceId = `test-eventlog-order-${crypto.randomUUID()}`

    await log.append({
      type: 'ProcessInstanceStarted',
      instanceId,
      definitionId: 'def-1',
      definitionVersion: 1,
    })
    await log.append({
      type: 'ProcessInstanceCompleted',
      instanceId,
    } as unknown as ExecutionEvent)

    const results = await log.getForInstance(instanceId)
    expect(results).toHaveLength(2)
    expect(results[0]!.occurredAt.getTime()).toBeLessThanOrEqual(results[1]!.occurredAt.getTime())
  })

  it('maps rows correctly — id is a string, occurredAt is a Date, data is the original event', async () => {
    const instanceId = `test-eventlog-map-${crypto.randomUUID()}`
    const event: ExecutionEvent = {
      type: 'ProcessInstanceStarted',
      instanceId,
      definitionId: 'def-map-1',
      definitionVersion: 2,
    }

    await log.append(event)
    const [row] = await log.getForInstance(instanceId)

    expect(typeof row!.id).toBe('string')
    expect(row!.occurredAt).toBeInstanceOf(Date)
    expect(row!.data).toMatchObject({ type: 'ProcessInstanceStarted', instanceId })
  })

  it('does not mix events across different instances', async () => {
    const idA = `test-eventlog-isolation-a-${crypto.randomUUID()}`
    const idB = `test-eventlog-isolation-b-${crypto.randomUUID()}`

    await log.append({
      type: 'ProcessInstanceStarted',
      instanceId: idA,
      definitionId: 'def-1',
      definitionVersion: 1,
    })
    await log.append({
      type: 'ProcessInstanceStarted',
      instanceId: idB,
      definitionId: 'def-1',
      definitionVersion: 1,
    })

    const resultsA = await log.getForInstance(idA)
    const resultsB = await log.getForInstance(idB)

    expect(resultsA).toHaveLength(1)
    expect(resultsB).toHaveLength(1)
    expect(resultsA[0]!.instanceId).toBe(idA)
    expect(resultsB[0]!.instanceId).toBe(idB)
  })
})
