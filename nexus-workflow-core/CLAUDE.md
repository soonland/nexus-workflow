# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                  # run all tests once
npm run test:watch        # run tests in watch mode
npm run test:coverage     # run tests with coverage report
npm run typecheck         # type-check without emitting
npm run build             # compile to dist/
```

Run a single test file:
```bash
npx vitest run src/adapters/InMemoryStateStore.test.ts
```

Run tests matching a name pattern:
```bash
npx vitest run -t "parallel gateway"
```

## Architecture

This is `nexus-workflow-core` — the engine half of a two-project BPMN workflow system. It is a pure TypeScript library with no runtime I/O dependencies. The companion app (`nexus-workflow-app`, not yet scaffolded) will provide HTTP, PostgreSQL, and UI on top of it.

**The central design principle:** the execution engine is a pure function — `execute(command, state) → (newState, events[])`. It has no side effects. All persistence and event emission happen outside the engine boundary, injected via interfaces.

### Key modules

- `src/model/types.ts` — all core data structures (`Token`, `ProcessInstance`, `VariableScope`, every BPMN element type). Read this first.
- `src/model/errors.ts` — typed error hierarchy (`DefinitionError`, `RuntimeError`, `SandboxViolationError`, etc.).
- `src/interfaces/` — abstract contracts for `StateStore`, `EventBus`, `Scheduler`, `ServiceTaskHandler`, `ExpressionEvaluator`. The engine depends only on these, never on concrete implementations.
- `src/adapters/` — in-memory implementations of all interfaces. Used directly in tests; the app provides real implementations.
- `src/engine/` — execution engine (not yet implemented). Will contain `ExecutionEngine`, `TokenRouter`, `StepRunner`, `GatewayEvaluator`, `EventManager`.
- `src/gateways/` — XOR, AND (parallel), OR (inclusive) gateway handlers (not yet implemented).

### Token and gateway semantics

Tokens are explicit records, not derived from history. Gateway join state (`ParallelGatewayJoinState`, `InclusiveGatewayJoinState`) is persisted explicitly — never inferred. Parallel joins track `arrivedFromFlows` as a set of flow IDs (not a count) to handle loops correctly. Inclusive joins additionally track `activatedIncomingFlows` set at split time.

### Testing conventions

- Unit tests are co-located: `Foo.ts` → `Foo.test.ts`
- Scenario (multi-step) tests live in `tests/scenarios/*.scenario.test.ts`
- All test builders are in `tests/fixtures/builders/` — always use `buildToken()`, `buildInstance()`, `buildDefinition()` rather than constructing raw objects
- Use `createTestContext()` to get a pre-wired set of in-memory adapters
- Custom Vitest matchers (`toContainEventType`, `toContainEventTypes`, `toHaveEventOrder`) are registered in `tests/setup.ts`
- Tests for adapters must pass before those adapters are used as infrastructure in other tests

### Implementation build order

When implementing new engine modules, follow this sequence: gateway tests first (before gateway implementation), then expression evaluator sandbox tests (before evaluator implementation). See `docs/ARCHITECTURE.md` for full Mermaid diagrams of all flows.
