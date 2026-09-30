# CLAUDE.md — nexus-workflow-console

Operator console for `nexus-workflow-app`: a small React single-page app for managing tenants and API keys. It is a client of the workflow API's `/tenants` admin endpoints, like `nexus-erp` is a client of the tenant endpoints. It never imports code from the other packages.

## Commands

```bash
pnpm dev           # Vite dev server on :3002 (open http://localhost:3002/console/), proxies /tenants to :3000
pnpm build         # type-check + production build into dist/
pnpm typecheck
pnpm lint
pnpm test          # Vitest + Testing Library (jsdom)
```

## How it fits together

- **Served by the API.** `nexus-workflow-app` serves `dist/` at `/console` (`src/http/console.ts`), on the same origin as the API, so the app calls `/tenants` with relative URLs and needs no CORS. `CONSOLE_DIR` overrides the location. The Docker image builds and ships it.
- **Auth = the admin key.** `AuthProvider` verifies a typed-in key with `GET /tenants` and keeps it in `sessionStorage` (this tab only). It is sent as `Authorization: Bearer <key>`. The admin key can manage tenants and keys but cannot read tenant data.
- **`src/api/client.ts`** is the only place that talks to the API; components take an `AdminApi` so tests pass a fake (`src/test/fakeApi.ts`) instead of mocking `fetch`.

## Conventions

- MUI 9: no system props on components (`alignItems`, `fontWeight`, ...); use `sx`. Use `slotProps`, not `InputProps`.
- Destructive actions (delete tenant, revoke key) go through `ConfirmDialog`; deleting a tenant requires typing its id.
- A new API key's plaintext is shown once and never stored in component state longer than the dialog needs it.
