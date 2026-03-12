import { describe, it, expect } from 'vitest'
import { parseBpmn, InMemoryStateStore, InMemoryEventBus, execute } from 'nexus-workflow-core'
import type { ExecutionEvent, EngineState } from 'nexus-workflow-core'
import { normalizeVariables, unwrapVariables, buildUserTaskCreationOps, computeStoreOps } from './engineHelpers.js'

// ─── normalizeVariables ───────────────────────────────────────────────────────

describe('normalizeVariables', () => {
  it('should wrap a raw string as { type: "string", value }', () => {
    const result = normalizeVariables({ greeting: 'hello' })
    expect(result['greeting']).toEqual({ type: 'string', value: 'hello' })
  })

  it('should wrap a raw number as { type: "number", value }', () => {
    const result = normalizeVariables({ count: 42 })
    expect(result['count']).toEqual({ type: 'number', value: 42 })
  })

  it('should wrap a raw boolean as { type: "boolean", value }', () => {
    const result = normalizeVariables({ active: true })
    expect(result['active']).toEqual({ type: 'boolean', value: true })
  })

  it('should wrap null as { type: "null", value: null }', () => {
    const result = normalizeVariables({ nothing: null })
    expect(result['nothing']).toEqual({ type: 'null', value: null })
  })

  it('should wrap a raw array as { type: "array", value }', () => {
    const arr = [1, 2, 3]
    const result = normalizeVariables({ items: arr })
    expect(result['items']).toEqual({ type: 'array', value: arr })
  })

  it('should wrap a raw plain object as { type: "object", value }', () => {
    const obj = { a: 1, b: 'two' }
    const result = normalizeVariables({ data: obj })
    expect(result['data']).toEqual({ type: 'object', value: obj })
  })

  it('should pass through an already-wrapped VariableValue unchanged', () => {
    const wrapped = { type: 'string', value: 'x' }
    const result = normalizeVariables({ myVar: wrapped })
    expect(result['myVar']).toEqual({ type: 'string', value: 'x' })
  })

  it('should normalise multiple keys at once correctly', () => {
    const result = normalizeVariables({
      name: 'Alice',
      age: 30,
      active: false,
      score: null,
    })
    expect(result['name']).toEqual({ type: 'string', value: 'Alice' })
    expect(result['age']).toEqual({ type: 'number', value: 30 })
    expect(result['active']).toEqual({ type: 'boolean', value: false })
    expect(result['score']).toEqual({ type: 'null', value: null })
  })
})

// ─── unwrapVariables ──────────────────────────────────────────────────────────

describe('unwrapVariables', () => {
  it('should unwrap a number VariableValue to its raw value', () => {
    const result = unwrapVariables({ x: { type: 'number', value: 42 } })
    expect(result).toEqual({ x: 42 })
  })

  it('should unwrap multiple VariableValues to raw values', () => {
    const result = unwrapVariables({
      a: { type: 'string', value: 'hi' },
      b: { type: 'boolean', value: false },
    })
    expect(result).toEqual({ a: 'hi', b: false })
  })

  it('should return an empty object for empty input', () => {
    expect(unwrapVariables({})).toEqual({})
  })

  it('should unwrap null VariableValue to null', () => {
    const result = unwrapVariables({ nothing: { type: 'null', value: null } })
    expect(result['nothing']).toBeNull()
  })
})

// ─── buildUserTaskCreationOps ─────────────────────────────────────────────────

const USER_TASK_BPMN_WITH_ASSIGNEE = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:nexus="http://nexus-workflow/extensions"
             targetNamespace="http://example.com">
  <process id="assignee-proc" name="Assignee Process" isExecutable="true">
    <startEvent id="start-1"><outgoing>f1</outgoing></startEvent>
    <userTask id="task-1" name="Review" nexus:assignee="\${reviewer}">
      <incoming>f1</incoming>
      <outgoing>f2</outgoing>
    </userTask>
    <endEvent id="end-1"><incoming>f2</incoming></endEvent>
    <sequenceFlow id="f1" sourceRef="start-1" targetRef="task-1"/>
    <sequenceFlow id="f2" sourceRef="task-1" targetRef="end-1"/>
  </process>
</definitions>`

const USER_TASK_BPMN_NO_ASSIGNEE = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://example.com">
  <process id="no-assignee-proc" name="No Assignee Process" isExecutable="true">
    <startEvent id="start-1"><outgoing>f1</outgoing></startEvent>
    <userTask id="task-1" name="Review">
      <incoming>f1</incoming>
      <outgoing>f2</outgoing>
    </userTask>
    <endEvent id="end-1"><incoming>f2</incoming></endEvent>
    <sequenceFlow id="f1" sourceRef="start-1" targetRef="task-1"/>
    <sequenceFlow id="f2" sourceRef="task-1" targetRef="end-1"/>
  </process>
</definitions>`

describe('buildUserTaskCreationOps', () => {
  it('returns a createUserTask op for a TokenWaiting user-task event', async () => {
    const { definition } = parseBpmn(USER_TASK_BPMN_NO_ASSIGNEE)
    const result = execute(definition!, { type: 'StartProcess' }, null)
    const events = result.events

    const ops = buildUserTaskCreationOps(events, definition!, result.newState)

    expect(ops).toHaveLength(1)
    expect(ops[0]!.op).toBe('createUserTask')
  })

  it('sets task name from the element name', async () => {
    const { definition } = parseBpmn(USER_TASK_BPMN_NO_ASSIGNEE)
    const result = execute(definition!, { type: 'StartProcess' }, null)
    const ops = buildUserTaskCreationOps(result.events, definition!, result.newState)
    const createOp = ops[0] as { op: 'createUserTask'; task: { name: string } }
    expect(createOp.task.name).toBe('Review')
  })

  it('resolves ${varName} assignee expression from root-scope variables', async () => {
    const { definition } = parseBpmn(USER_TASK_BPMN_WITH_ASSIGNEE)
    const result = execute(
      definition!,
      {
        type: 'StartProcess',
        variables: { reviewer: { type: 'string', value: 'alice' } },
      },
      null,
    )
    const ops = buildUserTaskCreationOps(result.events, definition!, result.newState)
    const createOp = ops[0] as { op: 'createUserTask'; task: { assignee?: string } }
    expect(createOp.task.assignee).toBe('alice')
  })

  it('returns the unresolved expression when variable is not in scope', async () => {
    const { definition } = parseBpmn(USER_TASK_BPMN_WITH_ASSIGNEE)
    const result = execute(definition!, { type: 'StartProcess' }, null)
    const ops = buildUserTaskCreationOps(result.events, definition!, result.newState)
    const createOp = ops[0] as { op: 'createUserTask'; task: { assignee?: string } }
    // Variable not set — resolveExpr returns the original expr
    expect(createOp.task.assignee).toContain('reviewer')
  })

  it('resolves ${varName} when the variable is stored as a raw primitive (non-wrapped)', async () => {
    const { definition } = parseBpmn(USER_TASK_BPMN_WITH_ASSIGNEE)
    const result = execute(definition!, { type: 'StartProcess' }, null)

    // Directly mutate the root scope to store a raw string (not a VariableValue wrapper)
    // This covers the `val` branch in resolveExpr (line 154 of engineHelpers.ts)
    const rootScope = result.newState.scopes.find(s => s.id === result.newState.instance.rootScopeId)!
    ;(rootScope.variables as Record<string, unknown>)['reviewer'] = 'bob' // raw primitive

    const ops = buildUserTaskCreationOps(result.events, definition!, result.newState)
    const createOp = ops[0] as { op: 'createUserTask'; task: { assignee?: string } }
    expect(createOp.task.assignee).toBe('bob')
  })

  it('returns empty array when events contain no TokenWaiting user-task event', () => {
    const { definition } = parseBpmn(USER_TASK_BPMN_NO_ASSIGNEE)
    const nonUserTaskEvents: ExecutionEvent[] = [
      { type: 'ProcessInstanceStarted', instanceId: 'inst-1', definitionId: 'def-1', definitionVersion: 1 },
    ]
    const state = execute(definition!, { type: 'StartProcess' }, null).newState
    const ops = buildUserTaskCreationOps(nonUserTaskEvents, definition!, state)
    expect(ops).toHaveLength(0)
  })

  it('sets task status to "open" on creation', async () => {
    const { definition } = parseBpmn(USER_TASK_BPMN_NO_ASSIGNEE)
    const result = execute(definition!, { type: 'StartProcess' }, null)
    const ops = buildUserTaskCreationOps(result.events, definition!, result.newState)
    const createOp = ops[0] as { op: 'createUserTask'; task: { status: string } }
    expect(createOp.task.status).toBe('open')
  })
})

// ─── computeStoreOps — gateway join state paths ──────────────────────────────

const PARALLEL_GATEWAY_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.com">
  <process id="parallel-proc" name="Parallel Process" isExecutable="true">
    <startEvent id="start-1"><outgoing>f0</outgoing></startEvent>
    <parallelGateway id="split-1"><incoming>f0</incoming><outgoing>f1</outgoing><outgoing>f2</outgoing></parallelGateway>
    <userTask id="task-a" name="Task A"><incoming>f1</incoming><outgoing>f3</outgoing></userTask>
    <userTask id="task-b" name="Task B"><incoming>f2</incoming><outgoing>f4</outgoing></userTask>
    <parallelGateway id="join-1"><incoming>f3</incoming><incoming>f4</incoming><outgoing>f5</outgoing></parallelGateway>
    <endEvent id="end-1"><incoming>f5</incoming></endEvent>
    <sequenceFlow id="f0" sourceRef="start-1" targetRef="split-1"/>
    <sequenceFlow id="f1" sourceRef="split-1" targetRef="task-a"/>
    <sequenceFlow id="f2" sourceRef="split-1" targetRef="task-b"/>
    <sequenceFlow id="f3" sourceRef="task-a" targetRef="join-1"/>
    <sequenceFlow id="f4" sourceRef="task-b" targetRef="join-1"/>
    <sequenceFlow id="f5" sourceRef="join-1" targetRef="end-1"/>
  </process>
</definitions>`

describe('computeStoreOps — gateway join state management', () => {
  it('includes saveGatewayState op when first branch of parallel join completes', () => {
    const { definition } = parseBpmn(PARALLEL_GATEWAY_BPMN)

    // Start the process — parallel split creates two waiting tokens
    const startResult = execute(definition!, { type: 'StartProcess' }, null)
    const startState = startResult.newState

    // Find one of the two waiting user task tokens
    const tokenA = startState.tokens.find(t => t.elementId === 'task-a' && t.status === 'waiting')!

    // Complete task-a — first branch arrives at the join
    const completeResult = execute(
      definition!,
      { type: 'CompleteUserTask', tokenId: tokenA.id, completedBy: 'user-1' },
      startState,
    )
    const newState = completeResult.newState

    // computeStoreOps for the update (not new instance)
    const ops = computeStoreOps(false, startState, newState)

    // There should be at least one saveGatewayState op (the parallel join recorded partial completion)
    const gwOps = ops.filter(op => op.op === 'saveGatewayState')
    expect(gwOps.length).toBeGreaterThan(0)
  })

  it('includes deleteGatewayState op when both branches complete (join state cleaned up)', () => {
    const { definition } = parseBpmn(PARALLEL_GATEWAY_BPMN)

    const startResult = execute(definition!, { type: 'StartProcess' }, null)
    const startState = startResult.newState

    const tokenA = startState.tokens.find(t => t.elementId === 'task-a' && t.status === 'waiting')!
    const tokenB = startState.tokens.find(t => t.elementId === 'task-b' && t.status === 'waiting')!

    // Complete task-a first (join records partial)
    const afterA = execute(
      definition!,
      { type: 'CompleteUserTask', tokenId: tokenA.id, completedBy: 'user-1' },
      startState,
    )

    // Complete task-b (join fires, gateway state removed)
    const afterB = execute(
      definition!,
      { type: 'CompleteUserTask', tokenId: tokenB.id, completedBy: 'user-2' },
      afterA.newState,
    )

    // The ops from afterA.newState → afterB.newState should include deleteGatewayState
    const ops = computeStoreOps(false, afterA.newState, afterB.newState)
    const deleteGwOps = ops.filter(op => op.op === 'deleteGatewayState')
    expect(deleteGwOps.length).toBeGreaterThan(0)
  })

  it('createInstance op is produced for a new instance', () => {
    const { definition } = parseBpmn(PARALLEL_GATEWAY_BPMN)
    const result = execute(definition!, { type: 'StartProcess' }, null)
    const ops = computeStoreOps(true, null, result.newState)
    const createOp = ops.find(op => op.op === 'createInstance')
    expect(createOp).toBeDefined()
  })

  it('updateInstance op is produced for an existing instance', () => {
    const { definition } = parseBpmn(PARALLEL_GATEWAY_BPMN)
    const result = execute(definition!, { type: 'StartProcess' }, null)
    const ops = computeStoreOps(false, result.newState, result.newState)
    const updateOp = ops.find(op => op.op === 'updateInstance')
    expect(updateOp).toBeDefined()
  })
})

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe('normalizeVariables → unwrapVariables round-trip', () => {
  it('should recover the original string value', () => {
    const original = { greeting: 'hello' }
    expect(unwrapVariables(normalizeVariables(original))).toEqual(original)
  })

  it('should recover the original number value', () => {
    const original = { count: 99 }
    expect(unwrapVariables(normalizeVariables(original))).toEqual(original)
  })

  it('should recover the original boolean value', () => {
    const original = { flag: true }
    expect(unwrapVariables(normalizeVariables(original))).toEqual(original)
  })

  it('should recover the original null value', () => {
    const original = { nothing: null }
    expect(unwrapVariables(normalizeVariables(original))).toEqual(original)
  })
})
