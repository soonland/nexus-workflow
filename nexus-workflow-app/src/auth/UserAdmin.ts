import type { InviteStore } from '../db/InviteStore.js'
import {
  EmailTakenError,
  LastOperatorError,
  UserInputError,
  type Membership,
  type MembershipRole,
  type UserStatus,
  type UserStore,
  type UserWithMemberships,
} from '../db/UserStore.js'
import { isOperator, managedTenantIds, type Principal } from './principal.js'

// ─── Results ──────────────────────────────────────────────────────────────────

export type FailureKind = 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID'
export interface Failure {
  ok: false
  error: FailureKind
  message: string
}
export type Outcome<T> = { ok: true; value: T } | Failure

const fail = (error: FailureKind, message: string): Failure => ({ ok: false, error, message })
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value })

// ─── Requests ─────────────────────────────────────────────────────────────────

export interface MembershipRequest {
  role: MembershipRole
  /** Null for `operator`; the tenant for `tenant_manager`. */
  tenantId: string | null
}

export interface CreateUserRequest {
  email: string
  name: string
  memberships?: MembershipRequest[]
}

export interface Invited {
  user: UserWithMemberships
  invite: { token: string; expiresAt: Date }
}

interface Scope {
  /** The signed-in user acting, or null for the admin key. */
  actorUserId: string | null
  operator: boolean
  /** Tenants a non-operator may administer people in. */
  managed: string[]
}

/**
 * Who may do what to whom when administering people. Every rule about users and memberships is
 * here, so the HTTP layer only translates results into status codes.
 *
 *  - An **operator** (or the admin key) administers anyone.
 *  - A **tenant manager** administers only people who belong *wholly* to tenants they manage:
 *    they hold a membership and every one of them is a manager role in one of those tenants. Anyone
 *    else (a person who also belongs to another tenant, any operator) is invisible to them (404),
 *    which also keeps a manager from taking over such an account by re-issuing its invite. They can
 *    never grant the operator role or a tenant they do not manage.
 *  - Nobody can disable themselves or strip their own operator role or last role; another
 *    administrator does that. The platform always keeps an active operator (enforced in UserStore).
 */
export class UserAdmin {
  constructor(
    private readonly users: UserStore,
    private readonly invites: InviteStore,
  ) {}

  async list(actor: Principal): Promise<Outcome<UserWithMemberships[]>> {
    const scope = this.scopeOf(actor)
    if (!('operator' in scope)) return scope
    return ok(await this.users.listWithMemberships(scope.operator ? {} : { withinTenants: scope.managed }))
  }

  async get(actor: Principal, userId: string): Promise<Outcome<UserWithMemberships>> {
    const scope = this.scopeOf(actor)
    if (!('operator' in scope)) return scope
    return this.reach(scope, userId)
  }

  /** Creates a person, gives them roles and issues their invite in one step. */
  async create(actor: Principal, request: CreateUserRequest): Promise<Outcome<Invited>> {
    const scope = this.scopeOf(actor)
    if (!('operator' in scope)) return scope

    const memberships = request.memberships ?? []
    if (!scope.operator) {
      if (memberships.length === 0) {
        return fail('FORBIDDEN', 'Give the new person at least one of your tenants (a manager role)')
      }
      const denied = memberships.find((m) => !this.mayGrant(scope, m))
      if (denied) return fail('FORBIDDEN', 'Tenant managers can only grant a manager role in tenants they manage')
    }
    for (const membership of memberships) {
      const invalid = await this.validateMembership(membership)
      if (invalid) return invalid
    }

    let created
    try {
      created = await this.users.createUser({ email: request.email, name: request.name })
    } catch (err) {
      return this.fromStoreError(err)
    }

    try {
      for (const membership of memberships) await this.users.addMembership(created.id, membership.role, membership.tenantId)
      const invite = await this.invites.create(created.id, scope.actorUserId)
      const user = await this.users.getWithMemberships(created.id)
      if (!user) throw new Error('Unexpected: the user just created was not found')
      return ok({ user, invite })
    } catch (err) {
      await this.users.deleteUser(created.id).catch(() => {}) // do not leave a half-created person behind
      return this.fromStoreError(err)
    }
  }

  async setStatus(actor: Principal, userId: string, status: UserStatus): Promise<Outcome<UserWithMemberships>> {
    const scope = this.scopeOf(actor)
    if (!('operator' in scope)) return scope
    const target = await this.reach(scope, userId)
    if (!target.ok) return target
    if (status === 'disabled' && scope.actorUserId === userId) {
      return fail('CONFLICT', 'You cannot disable your own account')
    }

    try {
      await this.users.setStatus(userId, status)
    } catch (err) {
      return this.fromStoreError(err)
    }
    return this.reach(scope, userId)
  }

  async addMembership(actor: Principal, userId: string, request: MembershipRequest): Promise<Outcome<Membership>> {
    const scope = this.scopeOf(actor)
    if (!('operator' in scope)) return scope
    const target = await this.reach(scope, userId)
    if (!target.ok) return target
    if (!scope.operator && !this.mayGrant(scope, request)) {
      return fail('FORBIDDEN', 'Tenant managers can only grant a manager role in tenants they manage')
    }
    const invalid = await this.validateMembership(request)
    if (invalid) return invalid

    try {
      return ok(await this.users.addMembership(userId, request.role, request.tenantId))
    } catch (err) {
      return this.fromStoreError(err)
    }
  }

  async removeMembership(actor: Principal, userId: string, membershipId: string): Promise<Outcome<null>> {
    const scope = this.scopeOf(actor)
    if (!('operator' in scope)) return scope
    const target = await this.reach(scope, userId)
    if (!target.ok) return target
    const membership = target.value.memberships.find((m) => m.id === membershipId)
    if (!membership) return fail('NOT_FOUND', 'Membership not found')

    // Taking your own role away is how people lock themselves out; someone else has to do it
    if (scope.actorUserId === userId && (membership.role === 'operator' || target.value.memberships.length === 1)) {
      return fail('CONFLICT', 'You cannot remove your own operator role or your last role; ask another administrator')
    }

    try {
      await this.users.removeMembership(userId, membershipId)
    } catch (err) {
      return this.fromStoreError(err)
    }
    return ok(null)
  }

  /**
   * Issues a new invite and retires the previous one. For someone who already has a password this is
   * the password reset: the invite sets a new one.
   */
  async reinvite(actor: Principal, userId: string): Promise<Outcome<Invited>> {
    const scope = this.scopeOf(actor)
    if (!('operator' in scope)) return scope
    const target = await this.reach(scope, userId)
    if (!target.ok) return target
    if (target.value.status !== 'active') return fail('CONFLICT', 'Enable the account before inviting the person again')

    const invite = await this.invites.create(userId, scope.actorUserId)
    return ok({ user: target.value, invite })
  }

  // ─── rules ─────────────────────────────────────────────────────────────────

  private scopeOf(actor: Principal): Scope | Failure {
    if (actor.kind === 'apiKey') return fail('FORBIDDEN', 'API keys cannot administer people')
    const operator = isOperator(actor)
    const managed = managedTenantIds(actor)
    if (!operator && managed.length === 0) return fail('FORBIDDEN', 'Operator or tenant manager role required')
    return { actorUserId: actor.kind === 'user' ? actor.user.id : null, operator, managed }
  }

  /** The user, if this actor may see and administer them; otherwise "not found". */
  private async reach(scope: Scope, userId: string): Promise<Outcome<UserWithMemberships>> {
    const within = scope.operator || (await this.users.isWithinTenants(userId, scope.managed))
    const user = within ? await this.users.getWithMemberships(userId) : null
    return user ? ok(user) : fail('NOT_FOUND', 'User not found')
  }

  /** A non-operator may grant a manager role in a tenant they manage, and nothing else. */
  private mayGrant(scope: Scope, request: MembershipRequest): boolean {
    return request.role === 'tenant_manager' && request.tenantId !== null && scope.managed.includes(request.tenantId)
  }

  private async validateMembership(request: MembershipRequest): Promise<Failure | null> {
    if (request.role === 'operator' && request.tenantId !== null) {
      return fail('INVALID', 'An operator is platform-wide and cannot be tied to a tenant')
    }
    if (request.role === 'tenant_manager') {
      if (request.tenantId === null) return fail('INVALID', 'A tenant manager needs a tenant')
      if (!(await this.users.tenantExists(request.tenantId))) return fail('INVALID', 'Tenant not found')
    }
    if (request.role !== 'operator' && request.role !== 'tenant_manager') return fail('INVALID', 'Unknown role')
    return null
  }

  private fromStoreError(err: unknown): Failure {
    if (err instanceof EmailTakenError || err instanceof LastOperatorError) return fail('CONFLICT', err.message)
    if (err instanceof UserInputError) return fail('INVALID', err.message)
    throw err
  }
}
