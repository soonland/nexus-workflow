# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # start dev server with hot reload (tsx watch)
npm run build         # compile to dist/
npm start             # run compiled output
npm run typecheck     # type-check without emitting
npm test              # run all tests once
npm run test:watch    # run tests in watch mode
```

Run a single test file:
```bash
npx vitest run src/db/PostgresStateStore.test.ts
```

Run tests matching a name pattern:
```bash
npx vitest run -t "health check"
```

## Module Structure

```
src/
  http/          # Hono route handlers — one file per resource (processes, instances, tasks, events)
  db/            # PostgreSQL StateStore implementation (implements StateStore from nexus-workflow-core)
  scheduler/     # PostgreSQL-backed Scheduler implementation (uses pg LISTEN/NOTIFY or a jobs table)
  worker/        # Service task worker queue — picks up ServiceTaskStarted events and dispatches handlers
  config.ts      # Environment variable config (DATABASE_URL, PORT, NODE_ENV)
  main.ts        # Entry point: wires all adapters, registers routes, starts the HTTP server
tests/
  setup.ts       # Vitest global setup (extend here: test DB connections, global mocks, etc.)
```

## Relationship to nexus-workflow-core

`nexus-workflow-app` is the infrastructure host. `nexus-workflow-core` is the pure engine.

- **One-way dependency**: the app depends on the core; the core never depends on the app.
- The core exports a `WorkflowEngine` (a pure function: `execute(command, state) → (newState, events[])`).
- The app provides concrete implementations of the core's abstract interfaces:
  - `StateStore` → `src/db/` (PostgreSQL)
  - `Scheduler` → `src/scheduler/` (PostgreSQL-backed timers)
  - `EventBus` → internal in-process bus, or a thin wrapper if Redis is added later
  - `ServiceTaskHandler` → registered via the worker in `src/worker/`

The core's in-memory adapters (in `nexus-workflow-core/src/adapters/`) are used only in core unit tests. The app always uses its own PostgreSQL adapters in production.

## Key Patterns

### One atomic DB transaction per execute() call

Every call to `engine.execute(command)` must be wrapped in a single PostgreSQL transaction:

1. Read the current `ProcessInstance` state from the DB (inside the transaction).
2. Call the pure engine function — this is synchronous and has no side effects.
3. Write the new state back to the DB (inside the same transaction).
4. Emit the returned events after the transaction commits.

This ensures no partial state is ever persisted. If step 2 or 3 fails, the transaction rolls back and no events are emitted.

### Task worker picks up ServiceTaskStarted events

When the engine emits a `ServiceTaskStarted` event, the worker (`src/worker/`) is responsible for:

1. Receiving the event (via the in-process EventBus or a durable queue).
2. Looking up the registered `ServiceTaskHandler` for the task type.
3. Calling the handler with the task input variables.
4. Calling `engine.execute({ type: 'CompleteServiceTask', ... })` with the handler's output.

Handlers must be idempotent — the worker uses at-least-once delivery semantics.

### Environment configuration

All runtime config is read from environment variables in `src/config.ts`. There are no hardcoded connection strings. For local development, set variables in a `.env` file (not committed) and load them with a tool like `dotenv` or the shell.

Required environment variables:
- `DATABASE_URL` — PostgreSQL connection string (default: `postgres://localhost/nexus_workflow`)
- `PORT` — HTTP server port (default: `3000`)
- `NODE_ENV` — `development` | `test` | `production` (default: `development`)
