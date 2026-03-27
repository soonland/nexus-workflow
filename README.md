# Nexus Workflow

A BPMN 2.0 workflow engine monorepo with three projects:

| Project | Description | Port |
|---|---|---|
| `nexus-workflow-core` | Pure TypeScript engine library — no I/O | — |
| `nexus-workflow-app` | HTTP API, PostgreSQL persistence, task worker | 3000 |
| `nexus-erp` | Next.js ERP front-end consuming the workflow engine | 3001 |

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
npm install
npm run dev
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
REDIS_URL=redis://localhost:6379
```

### Install, migrate & seed

```bash
cd nexus-erp
npm install
npm run db:migrate    # apply migrations
npm run db:seed       # wipe and insert seed data
```

### Run

```bash
npm run dev
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
RESET_DB=true npm run dev --prefix nexus-workflow-app

# Reset ERP DB (drops, migrates, seeds)
cd nexus-erp && npx prisma migrate reset
```
