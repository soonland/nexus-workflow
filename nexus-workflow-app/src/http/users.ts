import { Hono, type Context, type MiddlewareHandler } from 'hono'
import type { Failure, FailureKind, MembershipRequest, Outcome, UserAdmin } from '../auth/UserAdmin.js'
import type { MembershipRole, UserStatus } from '../db/UserStore.js'
import type { AppVariables } from './middleware/auth.js'

export interface UsersRouterDeps {
  admin: UserAdmin
  /** Admits operators and tenant managers (createPeopleAdminGuard); sets the principal. */
  guard: MiddlewareHandler<{ Variables: AppVariables }>
  /**
   * The origin the console is served from (PUBLIC_ORIGIN). When set, invites also carry an absolute
   * `url`; when not, only a `path`: the origin is never taken from the request.
   */
  publicOrigin?: string | undefined
}

const STATUS: Record<FailureKind, 400 | 403 | 404 | 409> = {
  INVALID: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
}

const ROLES: readonly MembershipRole[] = ['operator', 'tenant_manager']

type Ctx = Context<{ Variables: AppVariables }>

function invalid(c: Ctx, message: string) {
  return c.json({ error: 'VALIDATION_ERROR', message }, 400)
}

async function readObject(c: Ctx): Promise<Record<string, unknown> | Response> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return invalid(c, 'Invalid JSON body')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return invalid(c, 'Body must be a JSON object')
  return body as Record<string, unknown>
}

function parseMembership(value: unknown): MembershipRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { role, tenantId } = value as Record<string, unknown>
  if (typeof role !== 'string' || !ROLES.includes(role as MembershipRole)) return null
  if (tenantId !== null && tenantId !== undefined && typeof tenantId !== 'string') return null
  return { role: role as MembershipRole, tenantId: tenantId ?? null }
}

/**
 * Administration of people: list, invite, disable / re-enable, roles and invite links. Who may do
 * what to whom is decided by UserAdmin; this layer parses requests and maps outcomes to status codes.
 */
export function createUsersRouter(deps: UsersRouterDeps): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()
  const { admin } = deps

  // Responses carry one-time invite tokens
  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })
  app.use('*', deps.guard)

  const actor = (c: Ctx) => {
    const principal = c.get('principal')
    if (!principal) throw new Error('users router mounted without a guard')
    return principal
  }

  const reply = <T>(c: Ctx, outcome: Outcome<T>, success: (value: T) => Response) =>
    outcome.ok ? success(outcome.value) : c.json({ error: outcome.error, message: outcome.message }, STATUS[(outcome as Failure).error])

  // The invite link is the sensitive object, so it must never be built from request data such as
  // the Host header (an attacker-chosen host would end up in a link an operator then sends on).
  // The response always carries the path; the absolute `url` only when PUBLIC_ORIGIN is configured,
  // otherwise the console adds its own origin, which the browser knows for certain.
  const inviteBody = (invite: { token: string; expiresAt: Date }) => {
    const path = `/console/invite/${invite.token}`
    return {
      token: invite.token,
      path,
      ...(deps.publicOrigin ? { url: `${deps.publicOrigin}${path}` } : {}),
      expiresAt: invite.expiresAt,
    }
  }

  app.get('/', async (c) => reply(c, await admin.list(actor(c)), (users) => c.json({ users })))

  app.post('/', async (c) => {
    const body = await readObject(c)
    if (body instanceof Response) return body
    const { email, name, memberships } = body
    if (typeof email !== 'string' || typeof name !== 'string') return invalid(c, '"email" and "name" must be strings')

    let parsed: MembershipRequest[] | undefined
    if (memberships !== undefined) {
      if (!Array.isArray(memberships)) return invalid(c, '"memberships" must be a list')
      const list = memberships.map(parseMembership)
      if (list.some((m) => m === null)) return invalid(c, 'Each membership needs a valid "role" and, for tenant_manager, a "tenantId" string')
      parsed = list as MembershipRequest[]
    }

    return reply(c, await admin.create(actor(c), { email, name, ...(parsed ? { memberships: parsed } : {}) }), ({ user, invite }) =>
      c.json({ user, invite: inviteBody(invite) }, 201),
    )
  })

  app.get('/:id', async (c) => reply(c, await admin.get(actor(c), c.req.param('id')), (user) => c.json({ user })))

  app.patch('/:id', async (c) => {
    const body = await readObject(c)
    if (body instanceof Response) return body
    const { status } = body
    if (status !== 'active' && status !== 'disabled') return invalid(c, '"status" must be "active" or "disabled"')
    return reply(c, await admin.setStatus(actor(c), c.req.param('id'), status as UserStatus), (user) => c.json({ user }))
  })

  app.post('/:id/memberships', async (c) => {
    const body = await readObject(c)
    if (body instanceof Response) return body
    const membership = parseMembership(body)
    if (!membership) return invalid(c, 'A membership needs a valid "role" and, for tenant_manager, a "tenantId" string')
    return reply(c, await admin.addMembership(actor(c), c.req.param('id'), membership), (created) => c.json({ membership: created }, 201))
  })

  app.delete('/:id/memberships/:membershipId', async (c) =>
    reply(c, await admin.removeMembership(actor(c), c.req.param('id'), c.req.param('membershipId')), () => c.json({ success: true })),
  )

  app.post('/:id/invite', async (c) =>
    reply(c, await admin.reinvite(actor(c), c.req.param('id')), ({ user, invite }) => c.json({ user, invite: inviteBody(invite) })),
  )

  return app
}
