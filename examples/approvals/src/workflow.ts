/**
 * Everything this application knows about the workflow engine. The engine is the only storage:
 * a request is an instance, its fields are instance variables, and "waiting for a decision" is
 * an open user task.
 */

const PROCESS_ID = 'approval-request'

export type Decision = 'approved' | 'rejected'

export interface NewRequest {
  requester: string
  title: string
  amount: number
}

export interface ApprovalRequest extends NewRequest {
  id: string
  /** "stopped": suspended or cancelled in the engine, for example from the console. */
  status: 'pending' | Decision | 'stopped'
  /** The task to complete, while the request is pending. */
  taskId?: string
  comment?: string
}

export interface Approvals {
  deployIfMissing(xml: string): Promise<void>
  submit(request: NewRequest): Promise<void>
  list(): Promise<ApprovalRequest[]>
  decide(taskId: string, answer: { decision: Decision; decidedBy: string; comment: string }): Promise<void>
}

export interface EngineOptions {
  baseUrl: string
  /** A tenant API key. The "service" role is enough for everything here. */
  apiKey: string
  fetchFn?: typeof fetch
}

interface Instance {
  id: string
  status: string
  startedAt: string
}

interface Task {
  id: string
  instanceId: string
  status: string
}

export function createApprovals({ baseUrl, apiKey, fetchFn = fetch }: EngineOptions): Approvals {
  function send(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${apiKey}`)
    return fetchFn(`${baseUrl}${path}`, { ...init, headers })
  }

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await send(path, init)
    if (!res.ok) throw await failure(res)
    return (await res.json()) as T
  }

  async function failure(res: Response) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    return new Error(`Workflow API ${res.status}: ${body.message ?? body.error ?? res.statusText}`)
  }

  function postJson(path: string, body: unknown) {
    return call(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  return {
    async deployIfMissing(xml) {
      const res = await send(`/definitions/${PROCESS_ID}`)
      if (res.ok) return
      if (res.status !== 404) throw await failure(res)
      await call('/definitions', { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: xml })
    },

    async submit({ requester, title, amount }) {
      await postJson(`/definitions/${PROCESS_ID}/instances`, { variables: { requester, title, amount } })
    },

    // One call per instance to read its variables: fine for an example, not for thousands of requests.
    async list() {
      const [{ items: instances }, { items: tasks }] = await Promise.all([
        call<{ items: Instance[] }>(`/instances?definitionId=${PROCESS_ID}&pageSize=50`),
        call<{ items: Task[] }>('/tasks?pageSize=200'),
      ])
      // A task claimed in the console is still waiting for its decision
      const waiting = new Map(
        tasks.filter((t) => t.status === 'open' || t.status === 'claimed').map((t) => [t.instanceId, t.id]),
      )
      const newestFirst = [...instances].sort((a, b) => b.startedAt.localeCompare(a.startedAt))

      return Promise.all(
        newestFirst.map(async (instance): Promise<ApprovalRequest> => {
          const { variables } = await call<{ variables: Record<string, unknown> }>(`/instances/${instance.id}`)
          const taskId = instance.status === 'active' ? waiting.get(instance.id) : undefined
          let status: ApprovalRequest['status'] = 'stopped'
          if (instance.status === 'active') status = 'pending'
          if (instance.status === 'completed') status = variables['decision'] === 'approved' ? 'approved' : 'rejected'
          return {
            id: instance.id,
            requester: String(variables['requester'] ?? ''),
            title: String(variables['title'] ?? ''),
            amount: Number(variables['amount'] ?? 0),
            status,
            ...(taskId ? { taskId } : {}),
            ...(variables['comment'] ? { comment: String(variables['comment']) } : {}),
          }
        }),
      )
    },

    async decide(taskId, { decision, decidedBy, comment }) {
      await postJson(`/tasks/${encodeURIComponent(taskId)}/complete`, {
        completedBy: decidedBy,
        outputVariables: { decision, comment },
      })
    },
  }
}
