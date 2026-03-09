const DEFAULT_DATE = new Date('2026-01-01T00:00:00.000Z');
export function buildToken(overrides = {}) {
    return {
        id: 'tok-1',
        instanceId: 'inst-1',
        elementId: 'start_1',
        elementType: 'startEvent',
        status: 'active',
        scopeId: 'scope-1',
        createdAt: DEFAULT_DATE,
        updatedAt: DEFAULT_DATE,
        ...overrides,
    };
}
export function buildWaitingToken(waitingFor, overrides = {}) {
    return buildToken({
        status: 'waiting',
        waitingFor,
        ...overrides,
    });
}
export function buildTokenAt(elementId, elementType, overrides = {}) {
    return buildToken({ elementId, elementType, ...overrides });
}
//# sourceMappingURL=TokenBuilder.js.map