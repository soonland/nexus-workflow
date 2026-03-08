import type { ProcessInstance, InstanceStatus } from '../../../src/model/types.js'

const DEFAULT_DATE = new Date('2026-01-01T00:00:00.000Z')

export function buildInstance(overrides: Partial<ProcessInstance> = {}): ProcessInstance {
  return {
    id: 'inst-1',
    definitionId: 'proc-1',
    definitionVersion: 1,
    status: 'active' as InstanceStatus,
    rootScopeId: 'scope-1',
    startedAt: DEFAULT_DATE,
    ...overrides,
  }
}
