import { describe, expect, it } from 'vitest'
import { createApprovals } from './workflow.js'

type Call = { method: string; path: string; auth: string | null; body: unknown }

/** Stands in for the workflow API: one canned answer per "METHOD /path". */
function fakeApi(answers: Record<string, [number, unknown]>) {
  const calls: Call[] = []
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const path = url.pathname + url.search
    const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body
    calls.push({ method, path, auth: new Headers(init?.headers).get('authorization'), body })
    const answer = answers[`${method} ${path}`]
    if (!answer) throw new Error(`unexpected call: ${method} ${path}`)
    return Response.json(answer[1], { status: answer[0] })
  }
  const approvals = createApprovals({ baseUrl: 'http://engine', apiKey: 'secret', fetchFn })
  return { approvals, calls }
}

describe('deployIfMissing', () => {
  it('deploys the process when the engine does not have it', async () => {
    const { approvals, calls } = fakeApi({
      'GET /definitions/approval-request': [404, { error: 'NOT_FOUND' }],
      'POST /definitions': [201, { id: 'approval-request' }],
    })
    await approvals.deployIfMissing('<xml/>')
    expect(calls[1]).toMatchObject({ method: 'POST', body: '<xml/>', auth: 'Bearer secret' })
  })

  it('does nothing when the process is already there', async () => {
    const { approvals, calls } = fakeApi({
      'GET /definitions/approval-request': [200, { id: 'approval-request' }],
    })
    await approvals.deployIfMissing('<xml/>')
    expect(calls).toHaveLength(1)
  })

  it('fails with the status and message when the key is refused', async () => {
    const { approvals } = fakeApi({
      'GET /definitions/approval-request': [401, { error: 'UNAUTHORIZED', message: 'Invalid API key' }],
    })
    await expect(approvals.deployIfMissing('<xml/>')).rejects.toThrow('401: Invalid API key')
  })
})

describe('submit', () => {
  it('starts an instance carrying the request as variables', async () => {
    const { approvals, calls } = fakeApi({
      'POST /definitions/approval-request/instances': [201, {}],
    })
    await approvals.submit({ requester: 'sam', title: 'Laptop', amount: 1200 })
    expect(calls[0]!.body).toEqual({ variables: { requester: 'sam', title: 'Laptop', amount: 1200 } })
  })
})

describe('list', () => {
  const instance = (id: string, status: string, startedAt: string) => ({ id, status, startedAt })
  const detail = (variables: Record<string, unknown>) => [200, { variables }] as [number, unknown]

  it('combines instances, their variables and open tasks, newest first', async () => {
    const { approvals } = fakeApi({
      'GET /instances?definitionId=approval-request&pageSize=50': [
        200,
        {
          items: [
            instance('a', 'completed', '2026-01-01T00:00:00Z'),
            instance('b', 'active', '2026-01-03T00:00:00Z'),
            instance('c', 'completed', '2026-01-02T00:00:00Z'),
            instance('d', 'terminated', '2025-12-01T00:00:00Z'),
          ],
        },
      ],
      'GET /tasks?pageSize=200': [
        200,
        { items: [{ id: 'task-b', instanceId: 'b', status: 'open' }] },
      ],
      'GET /instances/a': detail({ requester: 'sam', title: 'A', amount: 1, decision: 'approved' }),
      'GET /instances/b': detail({ requester: 'sam', title: 'B', amount: 2 }),
      'GET /instances/c': detail({ requester: 'kim', title: 'C', amount: 3, decision: 'rejected', comment: 'no' }),
      'GET /instances/d': detail({ requester: 'kim', title: 'D', amount: 4 }),
    })

    const requests = await approvals.list()

    expect(requests.map((r) => [r.id, r.status, r.taskId])).toEqual([
      ['b', 'pending', 'task-b'],
      ['c', 'rejected', undefined],
      ['a', 'approved', undefined],
      ['d', 'stopped', undefined],
    ])
    expect(requests[1]).toMatchObject({ requester: 'kim', title: 'C', amount: 3, comment: 'no' })
  })
})

describe('decide', () => {
  it('completes the task with the decision as output variables', async () => {
    const { approvals, calls } = fakeApi({ 'POST /tasks/task-1/complete': [200, {}] })
    await approvals.decide('task-1', { decision: 'approved', decidedBy: 'alex', comment: 'ok' })
    expect(calls[0]!.body).toEqual({
      completedBy: 'alex',
      outputVariables: { decision: 'approved', comment: 'ok' },
    })
  })
})
