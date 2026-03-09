# Nexus Workflow — Roadmap

## Status

| Project | Status |
|---------|--------|
| `nexus-workflow-core` | ✅ Phase 1 complete — 217 tests |
| `nexus-workflow-app` | 🚧 Steps 1–6 complete — 220 tests |

---

## nexus-workflow-core — Phase 1 (done)

Everything the engine needs to run real BPMN processes:

- [x] Model types, error hierarchy, interfaces
- [x] In-memory adapters (StateStore, EventBus, Scheduler)
- [x] Gateway evaluators — XOR, AND (parallel), OR (inclusive)
- [x] Expression evaluator — sandboxed JS via `vm.runInNewContext`
- [x] Execution engine — pure function, token-passing model
- [x] Event handling — intermediate timer / message / signal catch events
- [x] Boundary events — timer, message, signal, error (interrupting + non-interrupting)
- [x] Admin commands — SuspendInstance, ResumeInstance, CancelInstance
- [x] BPMN XML parser — `fast-xml-parser`, all Phase 1 element types
- [x] Scenario tests — editorial approval workflow end-to-end

---

## nexus-workflow-app — Implementation Order

Each step follows TDD: tests first, then implementation.

### Step 1 — PostgreSQL StateStore (`src/db/`) ✅

The foundation. Everything else depends on this.

- [x] Database schema — 9 tables (JSONB blobs + indexed columns): `definitions`, `instances`, `tokens`, `variable_scopes`, `user_tasks`, `event_subscriptions`, `gateway_join_states`, `history_entries`, `scheduled_timers`
- [x] `PostgresStateStore` — implements the full `StateStore` interface from the core
- [x] `executeTransaction(ops[])` — all reads/writes in one atomic transaction via `sql.begin()`
- [x] Integration tests — 78 tests against a real PostgreSQL database (Docker)
- [x] `migrate.ts` — idempotent migration runner with `schema_migrations` tracking table
- [x] `docker-compose.yml` — Postgres 17 on port 5433 for local dev/testing

**Decision made:** JSONB blobs per entity + indexed flat columns for queries (`instance_id`, `status`, `correlation_key`, etc.).

---

### Step 2 — Process definition storage ✅

Before instances can run, definitions need to be stored and retrieved.

- [x] `definitions` table — stores parsed `ProcessDefinition` as JSONB + metadata (done in Step 1)
- [x] `POST /definitions` — upload BPMN XML, parse it, store it; 400 on malformed XML, 201 with `validationWarnings` for semantic issues
- [x] `GET /definitions` — list stored definitions (filterable by `?isDeployable=true|false`)
- [x] `GET /definitions/:id` — retrieve full definition (latest or `?version=N`)
- [x] `parseBpmn`, `ParseResult`, `ValidationError` exported from core index

**Note:** parser always returns a definition (`isDeployable: false` when errors exist); there is no 422 path — only 400 for structurally broken XML.

---

### Step 3 — Process instance HTTP API (`src/http/`) ✅

The main API surface. Thin handlers that call the engine and persist state.

- [x] `POST /definitions/:definitionId/instances` — start a new process instance (StartProcess)
- [x] `GET /instances/:id` — get instance + active tokens + root scope variables
- [x] `POST /instances/:id/commands` — generic command endpoint (all EngineCommands except StartProcess)
- [x] `GET /instances` — list instances (filterable by `status`, `definitionId`, `correlationKey`, `businessKey`, `startedAfter`, `startedBefore`; paginated)
- [x] `DELETE /instances/:id` — cancel an instance (idempotent)
- [x] `execute`, `EngineState`, `EngineCommand`, `EngineResult` exported from core index
- [x] `listGatewayStates(instanceId)` added to `StateStore` interface + implementations

Each handler follows this pattern:
1. `loadEngineState` — reconstruct `EngineState` from DB (instance + all tokens + scopes + gateway states)
2. `execute(definition, command, state)` — pure engine call
3. `computeStoreOps` — diff old vs new gateway states, build `StoreOperation[]`
4. `store.executeTransaction(ops)` — one atomic write
5. `eventBus.publishMany(events)` — emit after commit

---

### Step 4 — Task worker queue (`src/worker/`) ✅

Picks up `ServiceTaskStarted` events and dispatches registered handlers.

- [x] `TaskWorker` class — subscribes to `ServiceTaskStarted` on the EventBus
- [x] Handler registry — `worker.register(handler)` keyed by `handler.taskType`
- [x] Built-in handlers — `http-call` (fetch an external URL), `log` (write to console)
- [x] Error handling — retry with exponential backoff, then `FailServiceTask` after `maxAttempts`
- [x] At-least-once delivery — in-flight dedup via `Set<"${tokenId}:${attempt}">` + token status check

---

### Step 5 — PostgreSQL Scheduler (`src/scheduler/`) ✅

Turns wall-clock time into `FireTimer` commands at the right moment.

- [x] `scheduled_timers` table — already exists from Step 1; `StateStore.getDueTimers(before)` queries it
- [x] `PostgresScheduler` — implements the `Scheduler` interface; backed by `StateStore` (no direct SQL)
- [x] Polling loop — `start()` polls immediately, then every `pollIntervalMs` (default 5 s)
- [x] `TimerCoordinator` — wires three things: `TokenWaiting(timer)` → parse expression → `scheduler.schedule()`; `TokenCancelled` → `scheduler.cancel()`; `onTimerFired` → `execute(FireTimer)` → persist → emit events
- [x] `parseTimerExpression` — parses ISO 8601 datetime strings and durations (PT30S, P1D, etc.)
- [x] Cancel timers when a boundary token is cancelled (task completed normally)
- [x] `TimerFired` event emitted by coordinator for observability

**Alternative:** use PostgreSQL `pg_cron` extension or a dedicated job queue like `pgboss`. Decision can be deferred — the `Scheduler` interface keeps it swappable.

---

### Step 6 — User task API (`src/http/tasks/`) ✅

Dedicated endpoints for human task management.

- [x] `GET /tasks` — list open user tasks (filterable by assignee, process)
- [x] `GET /tasks/:id` — get task details + variables in scope
- [x] `POST /tasks/:id/complete` — submit completion with output variables
- [x] `POST /tasks/:id/claim` — assign task to a user
- [x] `POST /tasks/:id/release` — unassign

**Implementation notes:**
- `UserTaskRecord` is created atomically in the same transaction as the engine state, triggered by `TokenWaiting(user-task)` events from `execute()`
- Shared helpers extracted to `src/http/engineHelpers.ts`: `loadEngineState`, `computeStoreOps`, `buildUserTaskCreationOps`
- Completing a task calls `execute(CompleteUserTask)` + updates the record in one transaction
- Claim/release are pure metadata ops on `UserTaskRecord` — no engine call needed
- Sequential user tasks: completing task N creates task N+1 in the same transaction

---

### Step 7 — Admin API (`src/http/admin/`)

Operator interventions exposed via HTTP.

- [ ] `POST /instances/:id/suspend` — suspend an active instance
- [ ] `POST /instances/:id/resume` — resume a suspended instance
- [ ] `POST /instances/:id/cancel` — cancel an instance
- [ ] `POST /instances/:id/tasks/:tokenId/skip` — force-complete a stuck task

---

### Step 8 — Observability

Events stored for audit trail and UI display.

- [ ] `execution_events` table — append-only log of all `ExecutionEvent` records
- [ ] `GET /instances/:id/events` — full audit trail for an instance
- [ ] Basic metrics endpoint — active instances, suspended instances, task queue depth

---

## nexus-workflow-core — Phase 2 (future)

Engine features not yet implemented:

- [ ] Event-Based Gateway — fires on whichever catch event arrives first
- [ ] Call Activity execution — sub-process spawning and variable mapping
- [ ] Script task execution — run script body via JsEvaluator synchronously
- [ ] Multi-instance tasks — parallel/sequential loops over a collection
- [ ] Compensation events
- [ ] Transaction sub-processes

---

## Editorial website (example consumer)

Not part of this repo — would be a separate application that calls `nexus-workflow-app` over HTTP:

- `POST /definitions/:id/instances` to submit an article
- `POST /tasks/:id/complete` when an editor approves or rejects
- `GET /instances/:id` to show the current state of an article in the UI
- Subscribe to webhooks (future) for real-time status updates
