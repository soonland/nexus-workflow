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

> The development database lives in memory (`tmpfs`): its data is gone when the container is recreated (`docker compose down`, a Docker restart). Tenants, keys and users have to be created again then.

### Looking at the database (pgAdmin)

pgAdmin is available as an optional service, so you can see each tenant's schema and tables:

```bash
docker compose up -d pgadmin      # then open http://localhost:5050
```

- It is in the `tools` profile, so a plain `docker compose up -d` (and CI) does not start it.
- There is no pgAdmin login (desktop mode), so the port is bound to `127.0.0.1` only. **Do not publish it on a network.**
- The server *nexus (docker compose)* is already registered; its password is `nexus`. Expand *Databases → nexus_workflow → Schemas*: `public` holds the platform tables and each tenant has its own `tenant_<id>`.
- It is for development; the production compose file does not include it.

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
ADMIN_API_KEY=dev-admin-key-change-me pnpm --filter nexus-workflow-app dev

# Development (hot reload): http://localhost:3002/console/
pnpm --filter nexus-workflow-console dev

# Or build it once and let the workflow app serve it: http://localhost:3000/console/
pnpm --filter nexus-workflow-console build
```

Sign in with the same `ADMIN_API_KEY`. The key stays in that browser tab only (`sessionStorage`). The console page itself is public; every action it takes needs the key. The Docker image builds and serves it at `/console` automatically (set `CONSOLE_DIR` to serve a different build).

### Signing in (people)

People sign in with an email and password and get a session cookie. (API keys are for programs and are unchanged.)

| Request | Effect |
|---|---|
| `POST /auth/login` `{email, password}` | Start a session: sets the `nexus_session` cookie, returns the user and their memberships |
| `GET /auth/me` | The signed-in user and memberships, or `401` |
| `POST /auth/logout` | End the session and clear the cookie |

- **Cookie:** random token, `HttpOnly`, `SameSite=Strict`, `Secure` whenever the connection is HTTPS. Only a hash of the token is stored. A session ends after `SESSION_IDLE_MINUTES` of inactivity (default 480) or `SESSION_MAX_DAYS` in total (default 7), and when the user is disabled or changes their password.
- **CSRF:** every `POST` here must carry the header `X-Nexus-Console: 1`, and if the browser sends an `Origin` it must be the console's own (`PUBLIC_ORIGIN`, or the request's origin by default). Set `PUBLIC_ORIGIN` when a proxy rewrites the host.
- **Throttling:** failed sign-ins are counted three ways, and a locked key is refused for 15 minutes with `429` and `Retry-After` **even with the right password**: 5 failures for one account *from one address* (so a stranger guessing at your email locks only themselves out, not you on another address), 25 for one account from *anywhere* (guessing spread over many addresses), and 30 from one address against any accounts. Unknown emails are counted like real ones. Attempts still being checked count toward the limit, so a burst of parallel guesses cannot exceed it, and a lock is never dropped to make room for new entries (if the table of locks were ever completely full, new keys are refused until one expires). The counters are in memory (per process).
- **Behind a proxy:** set `TRUST_PROXY` to the number of proxies of yours in front of the server (`true` means 1; `2` for a CDN plus a load balancer). Then `X-Forwarded-For` / `X-Forwarded-Proto` are believed and the client address is the entry that many places from the end of `X-Forwarded-For`. Leave it unset when nothing sits in front: the header is client-controlled. If a request carries fewer `X-Forwarded-For` entries than that (the number is too high, or the app was reached without going through the proxies), its address is treated as unknown, per-address limits are skipped for it, and a warning is logged once.
- Failed sign-ins always answer `401 INVALID_CREDENTIALS` with the same body and about the same time, whether or not the account exists.

### Creating people and inviting them

There is no email server, so a person is invited with a **one-time link** that you hand them. They open it, choose their own password and are signed in.

**The first operator** (nobody can invite them) is created from the command line, against the database, with the same `DATABASE_URL` and `API_KEY_HMAC_SECRET` the server uses:

```bash
pnpm --filter nexus-workflow-app operator:create you@example.com --name "Your Name"
# prints: http://localhost:3000/console/invite/<token>
```

It is safe to run again: an existing account is kept and re-enabled, gains the operator role once, and gets a new link. That makes it the way back in if every operator is ever locked out.

After that, people are managed through the API (the console screen comes next):

| Request | Effect |
|---|---|
| `GET /users` | The people you may see: everyone for an operator; for a tenant manager, only people who belong *wholly* to tenants they manage |
| `POST /users` `{email, name, memberships?}` | Create a person with roles and get their invite back, shown only once: `invite.token`, `invite.path` (`/console/invite/<token>`) and, if `PUBLIC_ORIGIN` is set, an absolute `invite.url` |
| `GET /users/:id` | One person with their roles |
| `PATCH /users/:id` `{status}` | Disable (`"disabled"`) or re-enable (`"active"`); disabling ends their sessions |
| `POST /users/:id/memberships` `{role, tenantId}` · `DELETE /users/:id/memberships/:membershipId` | Give or take away a role |
| `POST /users/:id/invite` | A new link, which replaces the previous one. For someone who already has a password this is the **password reset** |
| `POST /auth/invite-info` `{token}` · `POST /auth/accept-invite` `{token, password}` | Public. What the invite link calls |

- **Who may do what:** operators administer anyone; a tenant manager can invite and manage people in their own tenants only, can never grant `operator` or a tenant they do not manage, and cannot see or touch anyone who also belongs elsewhere (those people are simply "not found").
- **Guard rails:** nobody can disable themselves or take away their own operator role or last role (another administrator does that), and the platform always keeps at least one active operator.
- **Link origin:** the server never builds a link from request data such as the `Host` header (a spoofed host would end up in a link you then send on). It returns the `path`, and the console adds its own origin; set `PUBLIC_ORIGIN` to also get a ready-made absolute `url`. `PUBLIC_ORIGIN` is normalised to the form browsers send in the `Origin` header (`https://Example.com/` becomes `https://example.com`) and the server refuses to start if it is not an http(s) origin.
- **Links:** valid for `INVITE_TTL_HOURS` (default 168 = 7 days), usable once, stored only as a hash, and replaced when a new one is issued. Accepting one sets the password and ends the person's other sessions. Guessing links is throttled per client address.

### Who can do what

Every request is made by one of these, and what it may do follows from that:

| Caller | Credential | Platform admin (`/tenants`) | A tenant's own data (definitions, instances, tasks, webhooks, ...) |
|---|---|---|---|
| **Operator** | signed-in user with the `operator` role, an **operator key**, or the admin key | yes | **no**: running the platform is not reading its customers' workflows |
| **Tenant manager** | signed-in user with the `tenant_manager` role for that tenant | no | yes, for the tenants they manage only |
| **Tenant API key** | `Authorization: Bearer <key>` | no | yes, for the key's own tenant, **as far as its role allows** (below) |
| Anonymous | none | no | no |

- **Tenant routes with a session:** a signed-in tenant manager names the tenant in the `X-Tenant` header and must manage it (`400` if the header is missing, `403` for any other tenant, and also for one that does not exist, so tenants cannot be probed). A tenant API key always acts as its own tenant; `X-Tenant` is ignored for keys.
- **Status codes:** `401` means "no valid credential, sign in"; `403` means "your credential is valid but not allowed". A suspended or deleting tenant rejects its managers with `403` and its keys with `401`.
- **Cookies and CSRF:** state-changing requests made with a session cookie need the `X-Nexus-Console: 1` header (and a matching `Origin`), on these routes as well as on `/auth`. Bearer credentials need neither. If both are sent, the Bearer credential wins.
- To look inside a tenant, an operator needs a membership or a key for it; this is deliberate.

#### Operator keys

Programs that administer the platform (create tenants and keys, manage people, read the audit log) use a named, revocable **operator key** instead of the shared `ADMIN_API_KEY`.

- A key looks like `nxop_...`, is shown **once** when it is created, and only its hash is stored. It can have an **expiry date**; an expired key is refused like a revoked one.
- It reaches what an operator reaches (`/tenants`, `/users`, `/audit`, ...) and, like an operator, **never a tenant's own data** (an operator key sent to a tenant route is a 401). It is kept in its own table (`operator_keys`), so it can never be looked up as a tenant key.
- **Managing them:** `GET /operator-keys`, `POST /operator-keys` `{ name, expiresAt? }`, `DELETE /operator-keys/:id`, or the *Operator keys* screen in the console. This is for **signed-in operators and the admin key only: an operator key cannot create, list or revoke keys** (it could otherwise make itself a replacement and outlive being revoked).
- **What it may not do to people:** grant the `operator` role (when creating a person or later), or re-issue an operator's invite (which would let whoever holds the link take that account over). Either would turn a key into a person with operator access, who could then create keys, so revoking the key would not end it. A signed-in operator or the admin key does these. It *can* create, invite, disable and offboard the people of tenants, so a provisioning program keeps working.
- **After a key leaks:** revoke it (effective at once), then review what it did: the audit log filters by actor, and it shows every tenant, tenant key and person it created (`key.create`, `user.create`, ...). Those are separate credentials and are not revoked with it. An operator key by design can create tenant keys and tenant managers, as an operator can (see #460).
- Everything a key does is in the audit log under its own name (actor kind `operatorKey`), and creating and revoking keys is logged (`operator-key.create`, `operator-key.revoke`). `GET /auth/me` describes a key (`{ operatorKey: { id, name, createdBy, createdAt, expiresAt }, role: "operator" }`).
- **`ADMIN_API_KEY` is break-glass, and best left unset in production.** It is one shared secret with full operator power, it never expires, and it cannot be rotated without a restart. Unset, it matches nothing. The way in is `nexus-workflow-app`'s first-operator command (see above), then people signing in and creating operator keys. Set it only to recover (for example when every operator is locked out), then unset it again. When it is set the server says so at startup: a warning in production, another when operator keys also exist, and it refuses to start in production with a key shorter than 16 characters. What it does shows in the audit log as "admin key", and `GET /auth/me` answers `{ adminKey: true, role: "operator" }` for it.

#### Roles of tenant API keys

A tenant key has a role, so a program gets only what it needs:

| Role | May | May not |
|---|---|---|
| `service` (default) | the runtime API: deploy and read definitions; start and read instances, their events and history; list, claim, release and complete tasks; send messages and signals; send engine commands other than the ones below | delete a definition; suspend, resume, cancel or restart an instance (also as the commands `SuspendInstance` / `ResumeInstance` / `CancelInstance`); webhooks; metrics |
| `tenant_manager` | everything in its tenant | |

- **Deny by default:** any route that is not on the `service` list (see `src/auth/keyPermissions.ts`) is closed to service keys, including routes added later, until someone decides otherwise. A refused call says which role it needs.
- **Who made a key:** a key records the person who created it (none for the admin key or the command line). `GET /auth/me` with `Authorization: Bearer <key>` describes the key (`{ apiKey: { id, name, tenantId, role, createdBy, createdAt } }`, never the secret), and the admin key as `{ adminKey: true, role: "operator" }`.
- **Creating and changing:** `POST /tenants/:id/keys` takes `{ name, role? }` (default `service`). An operator changes an existing key's role, keeping its secret, with `PATCH /tenants/:id/keys/:keyId` `{ role }`; the change is in the audit log (`key.role`). The command line takes `--role` and defaults to `tenant_manager`, because it issues a tenant's main integration key (the ERP's).

##### Upgrading existing keys (migration 013)

Every key that existed before the migration became `service`. A program that needs more keeps working once its key is **raised**, with no new secret to hand out:
- In the console: Tenants, Keys of the tenant, choose the role of the key.
- Or by API: `curl -X PATCH $API/tenants/<tenant>/keys/<keyId> -H "Authorization: Bearer $ADMIN_API_KEY" -H 'Content-Type: application/json' -d '{"role":"tenant_manager"}'`.

`nexus-erp` needs `tenant_manager`: its admin screens suspend, resume, restart and cancel instances and delete definitions. Raise its key (or provision a new one: `tenant:provision` defaults to `tenant_manager`). Until then those screens get 403 with a message naming the role.

### Webhook targets

A webhook is a request the server makes on a tenant's behalf, so the target is restricted:

- **https only.** `http://` is refused unless `WEBHOOK_ALLOW_HTTP=true` (local development).
- **No internal addresses.** A URL is refused (`400 INVALID_WEBHOOK_URL`) when its host is, or resolves to, a loopback, private, shared (CGNAT), link-local, multicast, reserved or documentation address, or carries credentials. The check runs when the webhook is registered **and again at every delivery**, and every address a name resolves to must pass.
- **The checked address is the one connected to.** The name is resolved once per delivery and the connection goes to that address (TLS still verifies the certificate against the host name), so a name that changes its answer cannot redirect the request.
- **No redirects, bounded time.** A `3xx` answer is a failed delivery and is not followed; a target that does not answer within 10 s is a failed attempt. Response bodies are never read.
- **Allow-list for internal targets.** `WEBHOOK_ALLOWED_HOSTS` takes a comma-separated list of host names, addresses or CIDR ranges (`erp.internal,10.1.0.0/16`) that may be reached although they are internal. Link-local addresses (cloud metadata services such as `169.254.169.254`) cannot be allow-listed.

### Managing tenants (admin API)

The `/tenants` endpoints are for platform operators: a signed-in operator, or `Authorization: Bearer $ADMIN_API_KEY` (set `ADMIN_API_KEY` when starting the workflow app). Tenant managers and tenant API keys cannot use them.

| Request | Effect |
|---|---|
| `GET /tenants` | List tenants with status and number of active keys. Add `?counts=true` for how busy each is (instances by status, unfinished tasks): numbers only, never process content; `counts` is `null` for a tenant that is being deleted |
| `POST /tenants` `{id, name}` | Create a tenant and provision its schema |
| `PATCH /tenants/:id` `{status?, name?}` | Suspend (`"suspended"`), reactivate (`"active"`) or rename. Suspending rejects the tenant's keys and stops its background workers. A tenant that is being deleted cannot be changed (409) |
| `DELETE /tenants/:id` | Permanently delete the tenant, its schema and all its data and keys. The tenant is first marked `deleting` (keys rejected, no reactivation), then its workers stop, its schema is dropped and its rows are removed. The `default` tenant is protected (409). If a step fails you get a 500 and the tenant stays `deleting`; run the `DELETE` again (every step can be repeated) |
| `POST/GET /tenants/:id/keys`, `DELETE /tenants/:id/keys/:keyId` | Create (`{name, role?}`, plaintext shown once), list and revoke keys |
| `PATCH /tenants/:id/keys/:keyId` `{role}` | Change what a key may do, keeping its secret (`service` or `tenant_manager`) |

### Audit log

Administrative actions and sign-ins are written to `public.audit_log`, and read with `GET /audit` (newest first).

| Written for | Actions |
|---|---|
| Tenants | `tenant.create`, `tenant.suspend`, `tenant.reactivate`, `tenant.rename`, `tenant.delete` |
| Keys | `key.create` (with its role), `key.role` (from, to), `key.revoke` (the key's id and name, never the key) |
| Operator keys | `operator-key.create` (name, expiry), `operator-key.revoke` |
| People | `user.create`, `user.disable`, `user.enable`, `membership.add`, `membership.remove`, `invite.create` (also a password reset), `invite.accept` |
| Signing in | `login.success`, `login.failure` (with the address and why; attempts the throttle refuses are not logged) |
| Forced steps | `step.force` (which step, the reason, and for a task on whose behalf; see below) |

Each entry has the actor (a person, the admin key, an operator key, a tenant key, or "anonymous" for a failed sign-in), the action, the tenants it is about, a target (a tenant, key or person id) and a few facts. Passwords, invite tokens and plaintext keys are never stored: callers pass only plain facts, and anything whose name suggests a secret is removed before writing. An entry is written after the action succeeded; if writing fails it is reported on the console and the action still stands. Entries have no foreign keys, so they outlive the tenant or person they are about.

`GET /audit` filters: `tenant`, `actor` (a user id, or a kind such as `adminKey`), `action` (exact, or a family such as `key`), `from`, `to` (ISO dates), `page` (from 0) and `pageSize` (1 to 100, default 50).
- **Operators** (and the admin key) read everything.
- **Tenant managers** read only entries that name tenants, *all* of which they manage; asking for another tenant is a 403. Sign-ins and other platform-wide entries are operators only.
- Tenant API keys and people with no admin role get 403.

The log is append-only and has no retention yet: it grows until it is trimmed by hand.

### Forcing a stuck step

`POST /instances/:id/force` lets a **signed-in tenant manager** push a stuck step along by hand. Body: `{ action, tokenId, reason, outputVariables?, error? }`.

| `action` | For a step that is | Does |
|---|---|---|
| `completeServiceTask` | a service task waiting for its worker | completes it (optional `outputVariables`) |
| `failServiceTask` | a service task waiting for its worker | fails it (`error: {code?, message?}`; the reason is the message by default), so a boundary event can catch it or the instance is suspended |
| `fireTimer` | a timer or timer boundary event | fires it now |
| `completeUserTask` | an open or claimed task | completes it as the person calling, recording the assignee as `onBehalfOf` |

- A **reason** (1 to 500 characters) is required. Tenant API keys are refused (403): the reason has to be attributed to a person.
- The step must still be what the instance is waiting at: if it has moved on, the answer is 409 `STEP_NOT_CURRENT` and nothing happens. An action that does not fit the step is 422 `WRONG_STEP_KIND`.
- It is the ordinary engine command plus accountability: the cycle carries a `StepForced` event (event log, webhooks, Redis stream), the step's history entry has `forced: {action, by, reason, onBehalfOf?}`, and the audit log gets a `step.force` entry.
- There is still no way to move an instance to an arbitrary element (see #430).

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
