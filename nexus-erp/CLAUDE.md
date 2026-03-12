# CLAUDE.md — nexus-erp

Next.js 16 ERP application. Uses nexus-workflow-app as a workflow backend.

## Commands

```bash
npm run dev           # start dev server on port 3001
npm run build         # production build
npm run typecheck     # type-check without emitting
npm run db:generate   # prisma generate (after schema change)
npm run db:migrate    # prisma migrate dev (create and apply migration)
npm run db:deploy     # prisma migrate deploy (apply in prod)
```

## Environment Variables

Copy `.env.local.example` → `.env.local` and fill in:
- `DATABASE_URL` — `nexus_erp` PostgreSQL DB
- `NEXTAUTH_SECRET` — random secret for JWT signing
- `NEXTAUTH_URL` — full URL of this app (default: http://localhost:3001)
- `WORKFLOW_API_URL` — URL of nexus-workflow-app (default: http://localhost:3000)

## Structure

- `prisma/schema.prisma` — DB schema (User, Employee, Timesheet)
- `src/auth.ts` — NextAuth v5 Credentials provider
- `src/proxy.ts` — route protection (Next.js 16 proxy file, replaces middleware.ts)
- `src/db/client.ts` — singleton PrismaClient
- `src/lib/workflow.ts` — typed HTTP client for nexus-workflow-app
- `src/lib/bpmn/` — BPMN definition + deployer
- `src/instrumentation.ts` — startup: deploy BPMN if missing
- `src/app/(auth)/` — public auth pages
- `src/app/(app)/` — protected app pages (auth guard in layout)
- `src/app/api/` — API routes

## MUI + Next.js Conventions

### Links in Server Components

Next.js 16 forbids passing functions as props from Server Components to Client Components.
MUI components (`Button`, `IconButton`, `CardActionArea`, etc.) are Client Components, so
**never write `component={NextLink}` inside a Server Component page** — it throws at runtime:

> Error: Functions cannot be passed directly to Client Components

`ThemeRegistry` already configures `MuiButtonBase.defaultProps.LinkComponent = NextLink` globally,
so all ButtonBase-derived components perform client-side navigation automatically when given an
`href` prop. Just use `href` directly:

```tsx
// ✅ Correct — works in both Server and Client Components
<Button href="/dashboard">Go to dashboard</Button>
<IconButton href="/back" size="small"><ArrowBackIcon /></IconButton>

// ❌ Wrong in Server Components — crashes Next.js 16
<Button component={NextLink} href="/dashboard">Go to dashboard</Button>
```

In **Client Components** (`'use client'`) the `component={NextLink}` pattern also still works,
but using just `href` is preferred for consistency.

## Key Flows

**Timesheet Submit:**
1. `POST /api/timesheets/[id]/submit` resolves manager user_id via employee.manager.user.id
2. Calls workflow-app `POST /definitions/timesheet-approval/instances`
3. Updates timesheet: `status='submitted'`, `workflowInstanceId=<id>`

**Task Approval:**
1. Manager visits `/tasks`, sees open tasks assigned to their user ID
2. `POST /api/tasks/[id]/complete` calls workflow-app `POST /tasks/:id/complete`
3. Finds timesheet by `workflowInstanceId`, updates status to `approved` or `rejected`
