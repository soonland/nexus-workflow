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
- **Auth = people, with the admin key as break-glass.** People sign in with email and password; the server sets an HttpOnly session cookie, so the page keeps nothing (`AuthProvider` asks `GET /auth/me` on load). `src/auth/roles.ts` turns the memberships into what to show: operators get Tenants + Users, tenant managers get Users (scoped by the server to their tenants). The admin key (behind "Advanced" on the sign-in page) is still verified with `GET /tenants`, kept in `sessionStorage` and sent as `Authorization: Bearer`. Every request carries `X-Nexus-Console: 1` (the server's CSRF check). Only a 401 signs the user out; a 403 is just "not allowed".
- **Tenant context.** Tenant screens get a `TenantApi` from `useTenantContext()` (`src/auth/TenantContext.tsx`); every call it makes sends `X-Tenant` for the selected tenant (a manager's session is not tied to one). One tenant: shown in the header; several: a switcher, remembered per tab. The tenant screens so far: Definitions (list, delete with typed id) and Instances (status filter, paging, suspend / resume straight away; cancel and restart ask first), Tasks (open by default; claim / release / complete as the signed-in person) and Webhooks (add / delete). Add every new API route to the dev proxy in `vite.config.ts` together with the screen that calls it. Operators and the admin key get no tenant screens (the operator role does not open tenant data).
- **Invitations.** `/console/invite/<token>` is a client-side route (no router library): `Shell` reads the token, removes it from the address bar at once and shows `InvitePage`. The token only ever travels in POST bodies.
- **`src/api/client.ts`** is the only place that talks to the API; components take an `AdminApi` so tests pass a fake (`src/test/fakeApi.ts`) instead of mocking `fetch`.

## Conventions

- MUI 9: no system props on components (`alignItems`, `fontWeight`, ...); use `sx`. Use `slotProps`, not `InputProps`.
- Destructive actions (delete tenant, revoke key) go through `ConfirmDialog`; deleting a tenant requires typing its id.
- A new API key's plaintext is shown once and never stored in component state longer than the dialog needs it.
