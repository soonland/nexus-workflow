const DEFAULT_DATE = new Date('2026-01-01T00:00:00.000Z');
export function buildInstance(overrides = {}) {
    return {
        id: 'inst-1',
        definitionId: 'proc-1',
        definitionVersion: 1,
        status: 'active',
        rootScopeId: 'scope-1',
        startedAt: DEFAULT_DATE,
        ...overrides,
    };
}
//# sourceMappingURL=ProcessInstanceBuilder.js.map