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

## Key Flows

**Timesheet Submit:**
1. `POST /api/timesheets/[id]/submit` resolves manager user_id via employee.manager.user.id
2. Calls workflow-app `POST /definitions/timesheet-approval/instances`
3. Updates timesheet: `status='submitted'`, `workflowInstanceId=<id>`

**Task Approval:**
1. Manager visits `/tasks`, sees open tasks assigned to their user ID
2. `POST /api/tasks/[id]/complete` calls workflow-app `POST /tasks/:id/complete`
3. Finds timesheet by `workflowInstanceId`, updates status to `approved` or `rejected`
