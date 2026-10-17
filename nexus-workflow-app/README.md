# nexus-workflow-app

Host application for `nexus-workflow-core`: HTTP API, PostgreSQL persistence and the task worker. See [CLAUDE.md](./CLAUDE.md) for commands and module structure.

## Tenant lifecycle

Tenants are managed through the `/tenants` router. The full contract is in [openapi.yaml](./openapi.yaml). Calls need `Authorization: Bearer <ADMIN_API_KEY>` (or an operator session).

### Statuses

| Status | Meaning |
|---|---|
| `active` | Normal. Its API keys work and new keys can be issued. |
| `suspended` | Its API keys are rejected with 401 and its background workers stop. No new keys can be created (403). Reversible with `PATCH /tenants/:id` `{ "status": "active" }`. |
| `deleting` | A deletion has started. Keys are rejected, and the tenant can no longer be renamed or reactivated (409). Still returned by `GET /tenants` and `GET /tenants/:id` until it is gone. |

### Endpoints

| Call | Purpose |
|---|---|
| `POST /tenants` | Create a tenant (`id`, `name`) and provision its schema. |
| `GET /tenants` | List tenants. |
| `GET /tenants/:id` | Get one tenant. |
| `PATCH /tenants/:id` | Rename (`name`) and/or suspend or reactivate (`status`: `active` \| `suspended`). |
| `DELETE /tenants/:id` | Delete the tenant, drop its schema and revoke/remove its keys. |
| `POST /tenants/:id/keys` | Create a key. The plaintext is returned only in this response. |
| `GET /tenants/:id/keys` | List keys. |
| `PATCH /tenants/:id/keys/:keyId` | Change a key's role. |
| `DELETE /tenants/:id/keys/:keyId` | Revoke a key. |

### Deleting is retryable

`DELETE /tenants/:id` marks the tenant `deleting` first, then stops its workers, drops the schema and removes the tenant and its keys. If a step fails the response is `500 DELETE_FAILED`; the tenant stays `deleting` and the same `DELETE` can simply be retried (every step is safe to repeat). The `default` tenant is protected: deleting it always returns 409.

### Per-tenant counts

`GET /tenants?counts=true` adds a `counts` object to each tenant (instances by status and unfinished tasks; numbers only). `counts` is `null` for `deleting` tenants, whose schema may already be gone, and for any tenant that could not be counted in time.

### Scripted setup

There is no operator CLI for suspend/delete; use the endpoints above or the operator console. To create a tenant and issue its first key from a script, use:

```bash
pnpm --filter nexus-workflow-app tenant:provision <tenantId> [--name <name>] [--key-name <label>] [--role tenant_manager|service] [--write-env <path>]
```
