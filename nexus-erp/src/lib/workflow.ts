const BASE_URL = process.env.WORKFLOW_API_URL ?? 'http://localhost:3000'

export interface WorkflowInstance {
  id: string
  definitionId: string
  definitionVersion: number
  status: string
  startedAt: string
  completedAt?: string
}

export interface WorkflowTask {
  id: string
  instanceId: string
  elementId: string
  name: string
  assignee?: string
  status: 'open' | 'claimed' | 'completed' | 'cancelled'
  createdAt: string
  claimedAt?: string
  completedAt?: string
}

export interface TaskListResult {
  items: WorkflowTask[]
  total: number
  page: number
  pageSize: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Workflow API error ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

export async function deployDefinition(xml: string): Promise<{ id: string; version: number }> {
  const res = await fetch(`${BASE_URL}/definitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: xml,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to deploy definition: ${res.status} ${body}`)
  }
  return res.json() as Promise<{ id: string; version: number }>
}

export async function getDefinition(id: string): Promise<{ id: string } | null> {
  const res = await fetch(`${BASE_URL}/definitions/${id}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Workflow API error ${res.status}`)
  return res.json() as Promise<{ id: string }>
}

export async function getDefinitionXml(id: string, version?: number): Promise<string | null> {
  const qs = version !== undefined ? `?version=${version}` : ''
  const res = await fetch(`${BASE_URL}/definitions/${id}/xml${qs}`, { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Workflow API error ${res.status}`)
  return res.text()
}

export async function startInstance(
  definitionId: string,
  variables: Record<string, unknown>,
  businessKey?: string,
): Promise<WorkflowInstance> {
  const result = await request<{ instance: WorkflowInstance }>(`/definitions/${definitionId}/instances`, {
    method: 'POST',
    body: JSON.stringify({ variables, ...(businessKey ? { businessKey } : {}) }),
  })
  return result.instance
}

export async function listTasks(params: {
  assignee?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<TaskListResult> {
  const qs = new URLSearchParams()
  if (params.assignee) qs.set('assignee', params.assignee)
  if (params.status) qs.set('status', params.status)
  if (params.page !== undefined) qs.set('page', String(params.page))
  if (params.pageSize !== undefined) qs.set('pageSize', String(params.pageSize))
  return request<TaskListResult>(`/tasks?${qs.toString()}`)
}

export async function getTask(id: string): Promise<{ task: WorkflowTask; variables: Record<string, unknown> }> {
  return request(`/tasks/${id}`)
}

export async function completeTask(
  id: string,
  completedBy: string,
  outputVariables?: Record<string, unknown>,
): Promise<{ task: WorkflowTask; instance: WorkflowInstance }> {
  return request(`/tasks/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ completedBy, ...(outputVariables ? { outputVariables } : {}) }),
  })
}

export interface WorkflowDefinition {
  id: string
  version: number
  name: string | null
  deployedAt: string
  isDeployable: boolean
}

export interface BpmnElement {
  id: string
  type: string
  name?: string
  incomingFlows: string[]
  outgoingFlows: string[]
  [key: string]: unknown
}

export interface BpmnSequenceFlow {
  id: string
  sourceRef: string
  targetRef: string
  conditionExpression?: string
  isDefault?: boolean
}

export interface FullProcessDefinition extends WorkflowDefinition {
  elements: BpmnElement[]
  sequenceFlows: BpmnSequenceFlow[]
  startEventId: string
}

export async function getFullDefinition(id: string, version?: number): Promise<FullProcessDefinition | null> {
  const qs = version !== undefined ? `?version=${version}` : ''
  const res = await fetch(`${BASE_URL}/definitions/${id}${qs}`, { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Workflow API error ${res.status}`)
  return res.json() as Promise<FullProcessDefinition>
}

export interface WorkflowToken {
  id: string
  instanceId: string
  elementId: string
  elementType: string
  status: string
  waitingFor?: { type: string; correlationData?: Record<string, unknown> }
  createdAt: string
  updatedAt: string
}

export interface StoredExecutionEvent {
  id: string
  instanceId: string | null
  type: string
  occurredAt: string
  data: Record<string, unknown>
}

export interface InstanceListResult {
  items: WorkflowInstance[]
  total: number
  page: number
  pageSize: number
}

export async function listInstances(params?: {
  status?: string
  definitionId?: string
  page?: number
  pageSize?: number
}): Promise<InstanceListResult> {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.definitionId) qs.set('definitionId', params.definitionId)
  if (params?.page !== undefined) qs.set('page', String(params.page))
  if (params?.pageSize !== undefined) qs.set('pageSize', String(params.pageSize))
  return request<InstanceListResult>(`/instances?${qs.toString()}`, { cache: 'no-store' } as RequestInit)
}

export async function getInstance(id: string): Promise<{ instance: WorkflowInstance; tokens: WorkflowToken[]; variables: Record<string, unknown> } | null> {
  const res = await fetch(`${BASE_URL}/instances/${id}`, { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Workflow API error ${res.status}`)
  return res.json()
}

export async function listDefinitions(): Promise<WorkflowDefinition[]> {
  return request<WorkflowDefinition[]>('/definitions', { cache: 'no-store' } as RequestInit)
}

export async function getInstanceEvents(id: string): Promise<StoredExecutionEvent[]> {
  const data = await request<{ events: StoredExecutionEvent[] }>(`/instances/${id}/events`, { cache: 'no-store' } as RequestInit)
  return data.events
}

export async function suspendInstance(id: string): Promise<{ instance: WorkflowInstance }> {
  return request(`/instances/${id}/suspend`, { method: 'POST' })
}

export async function resumeInstance(id: string): Promise<{ instance: WorkflowInstance }> {
  return request(`/instances/${id}/resume`, { method: 'POST' })
}

export async function cancelInstance(id: string): Promise<{ instance: WorkflowInstance }> {
  return request(`/instances/${id}`, { method: 'DELETE' })
}
