# Nexus Workflow

A BPMN 2.0 workflow engine monorepo with three projects:

| Project | Description | Port |
|---|---|---|
| `nexus-workflow-core` | Pure TypeScript engine library — no I/O | — |
| `nexus-workflow-app` | HTTP API, PostgreSQL persistence, task worker | 3000 |
| `nexus-erp` | Next.js ERP front-end consuming the workflow engine | 3001 |
| `nexus-workflow-console` | Operator console (React): manage tenants and API keys | served at `/console` on 3000 (dev: 3002) |

---

## Prerequisites

- Node.js 20+
- PostgreSQL
- Redis
- Docker (optional, for infrastructure)

---

## Running with Docker (production)

Build and start `nexus-workflow-app` together with PostgreSQL and Redis in a single command:

```bash
docker compose -f docker-compose.prod.yml up -d
```

This builds the app image from source and starts three services:
- **nexus-workflow-app** on `localhost:3000`
- **PostgreSQL 17** (data persisted in a named volume)
- **Redis 7**

Verify the service is healthy:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

**Environment overrides** — create a `.env` file at the repo root before starting:

```env
POSTGRES_PASSWORD=changeme          # default: nexus (change this in production)
PORT=3000                           # default: 3000
REDIS_URL=redis://redis:6379        # default: bundled redis service
```

> **Note:** `docker-compose.yml` (without the `.prod` suffix) is for local development and CI — it uses ephemeral `tmpfs` storage and does not run the app container.

---

## Infrastructure

Start PostgreSQL and Redis with Docker (development only):

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on `localhost:5433` (user/pass/db: `nexus`)
- **Redis** on `localhost:6379`

> The Docker PostgreSQL instance is shared by both apps. `nexus_workflow` and `nexus_erp` are separate databases created automatically by migrations/seed.

---

## nexus-workflow-app

### Environment

Create `nexus-workflow-app/.env`:

```env
DATABASE_URL=postgres://nexus:nexus@localhost:5433/nexus_workflow
PORT=3000
REDIS_URL=redis://localhost:6379
```

Optional:
```env
RESET_DB=true   # drop and recreate all tables on next startup (dev only)
```

### Install & run

```bash
cd nexus-workflow-app
pnpm install
pnpm dev
```

Migrations run automatically on startup. The app will log `[RedisStreamPublisher] connected` if Redis is reachable.

---

## nexus-erp

### Environment

Copy the example and fill in:

```bash
cp nexus-erp/.env.local.example nexus-erp/.env.local
```

`nexus-erp/.env.local`:

```env
DATABASE_URL=postgresql://nexus:nexus@localhost:5433/nexus_erp
NEXTAUTH_SECRET=any-random-string
NEXTAUTH_URL=http://localhost:3001
WORKFLOW_API_URL=http://localhost:3000
WORKFLOW_API_KEY=...            # see "The ERP's workflow tenant and API key" below
WORKFLOW_TENANT_ID=nexus-erp
REDIS_URL=redis://localhost:6379
```

### The ERP's workflow tenant and API key

`nexus-workflow-app` is multi-tenant: every request needs `Authorization: Bearer <key>`, and the key decides which tenant's data you see. `nexus-erp` is just one tenant of the engine, called `nexus-erp`, with its own key in `WORKFLOW_API_KEY`. `pnpm init` creates both.

To create or replace them by hand (the database must be reachable; the workflow app does not need to be running):

```bash
pnpm --filter nexus-workflow-app tenant:provision nexus-erp --name "Nexus ERP" \
  --write-env ../nexus-erp/.env.local        # writes WORKFLOW_API_KEY there
```

Notes:
- The key is shown only once (only its hash is stored). Without `--write-env` the command prints it instead.
- Keys are hashed with `API_KEY_HMAC_SECRET`; run the command and the workflow app with the same value (unset in dev is fine, as long as both agree).
- Run it again to issue an additional key; the tenant and its data are kept. The docker dev database is ephemeral, so recreate the key when the containers are recreated.
- `WORKFLOW_TENANT_ID` (default `nexus-erp`) tells the ERP's Redis consumer which tenant's events to act on.

### Operator console

A small web UI for the admin API below: list, create, suspend, reactivate and delete tenants, and create or revoke their API keys (a new key is shown once, with a copy button).

```bash
# Start the workflow app with an admin key
ADMIN_API_KEY=dev-admin-key pnpm --filter nexus-workflow-app dev

# Development (hot reload): http://localhost:3002/console/
pnpm --filter nexus-workflow-console dev

# Or build it once and let the workflow app serve it: http://localhost:3000/console/
pnpm --filter nexus-workflow-console build
```

Sign in with the same `ADMIN_API_KEY`. The key stays in that browser tab only (`sessionStorage`). The console page itself is public; every action it takes needs the key. The Docker image builds and serves it at `/console` automatically (set `CONSOLE_DIR` to serve a different build).

### Managing tenants (admin API)

The `/tenants` endpoints are for the platform operator and take `Authorization: Bearer $ADMIN_API_KEY` (set `ADMIN_API_KEY` when starting the workflow app). Tenant API keys cannot use them.

| Request | Effect |
|---|---|
| `GET /tenants` | List tenants with status and number of active keys |
| `POST /tenants` `{id, name}` | Create a tenant and provision its schema |
| `PATCH /tenants/:id` `{status?, name?}` | Suspend (`"suspended"`), reactivate (`"active"`) or rename. Suspending rejects the tenant's keys and stops its background workers. A tenant that is being deleted cannot be changed (409) |
| `DELETE /tenants/:id` | Permanently delete the tenant, its schema and all its data and keys. The tenant is first marked `deleting` (keys rejected, no reactivation), then its workers stop, its schema is dropped and its rows are removed. The `default` tenant is protected (409). If a step fails you get a 500 and the tenant stays `deleting`; run the `DELETE` again (every step can be repeated) |
| `POST/GET /tenants/:id/keys`, `DELETE /tenants/:id/keys/:keyId` | Create (plaintext shown once), list and revoke keys |

### Install, migrate & seed

```bash
cd nexus-erp
pnpm install
pnpm db:migrate    # apply migrations
pnpm db:seed       # wipe and insert seed data
```

### Run

```bash
pnpm dev
```

On startup, the app deploys BPMN workflow definitions and starts the Redis stream consumer. You should see:

```
[bpmn] deployed timesheet-approval v1
[bpmn] deployed update-profile-info v1
[redisConsumer] listening on stream nexus:workflow:events
```

### Seed accounts

| Email | Password | Role |
|---|---|---|
| `manager@nexus.local` | `password123` | Manager |
| `bob@nexus.local` | `password123` | Employee |
| `carol@nexus.local` | `password123` | Employee |
| `dave@nexus.local` | `password123` | Employee |

---

## Start order

Services must start in this order:

1. Docker (PostgreSQL + Redis)
2. `nexus-workflow-app`
3. `nexus-erp`

---

## Reset everything

```bash
# Reset workflow DB (drops and recreates all tables)
RESET_DB=true pnpm --filter nexus-workflow-app dev

# Reset ERP DB (drops, migrates, seeds)
cd nexus-erp && npx prisma migrate reset
```
