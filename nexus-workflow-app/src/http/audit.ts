import { Hono, type MiddlewareHandler } from 'hono'
import { isOperator, managedTenantIds } from '../auth/principal.js'
import type { AuditLog } from '../db/AuditLog.js'
import type { AppVariables } from './middleware/auth.js'

export interface AuditRouterDeps {
  audit: AuditLog
  /** Admits operators and tenant managers (createPeopleAdminGuard); sets the principal. */
  guard: MiddlewareHandler<{ Variables: AppVariables }>
}

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 50

const invalid = (message: string) => ({ error: 'VALIDATION_ERROR', message })

function whole(text: string | undefined, fallback: number, min: number, max: number): number | null {
  if (text === undefined) return fallback
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return n >= min && n <= max ? n : null
}

function date(text: string | undefined): Date | undefined | 'invalid' {
  if (text === undefined || text === '') return undefined
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? 'invalid' : parsed
}

/**
 * GET /audit: the audit log, newest first.
 *  - An operator (or the admin key) reads everything.
 *  - A tenant manager reads only entries that name tenants, all of which they manage; asking for
 *    another tenant is refused (403), not quietly answered with nothing.
 * Filters: tenant, actor (a user id or a kind such as `adminKey`), action (exact, or a family such as
 * `key`), from, to (ISO dates); page (from 0) and pageSize (up to 100).
 */
export function createAuditRouter(deps: AuditRouterDeps): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', deps.guard)
  // Entries describe who did what; they are not for caches
  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.get('/', async (c) => {
    const principal = c.get('principal')
    if (!principal) return c.json({ error: 'UNAUTHENTICATED', message: 'Not signed in' }, 401)

    const q = c.req.query()
    const page = whole(q['page'], 0, 0, 1_000_000)
    const pageSize = whole(q['pageSize'], DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
    if (page === null) return c.json(invalid('"page" must be a whole number, starting at 0'), 400)
    if (pageSize === null) return c.json(invalid(`"pageSize" must be a whole number from 1 to ${MAX_PAGE_SIZE}`), 400)
    const from = date(q['from'])
    const to = date(q['to'])
    if (from === 'invalid') return c.json(invalid('"from" must be a date, e.g. 2026-03-01T00:00:00Z'), 400)
    if (to === 'invalid') return c.json(invalid('"to" must be a date, e.g. 2026-03-31T23:59:59Z'), 400)

    // What this person may read. The restriction is applied below the filters, so no filter can widen it.
    let visibleToManagerOf: string[] | undefined
    if (!isOperator(principal)) {
      const managed = managedTenantIds(principal)
      if (managed.length === 0) return c.json({ error: 'FORBIDDEN', message: 'Operator or tenant manager role required' }, 403)
      if (q['tenant'] && !managed.includes(q['tenant'])) {
        return c.json({ error: 'FORBIDDEN', message: 'You can only read the audit log of tenants you manage' }, 403)
      }
      visibleToManagerOf = managed
    }

    const result = await deps.audit.list({
      page,
      pageSize,
      ...(visibleToManagerOf ? { visibleToManagerOf } : {}),
      ...(q['tenant'] ? { tenantId: q['tenant'] } : {}),
      ...(q['actor'] ? { actor: q['actor'] } : {}),
      ...(q['action'] ? { action: q['action'] } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    })
    return c.json(result)
  })

  return app
}
