import type { Within } from '../db/atomically.js'
import type { AuditInput, AuditLog } from '../db/AuditLog.js'
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
import { auditActorOf } from './auditActor.js'
import { isOperator, isSystemAdmin, managedTenantIds, type Principal } from './principal.js'

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

/**
 * What an operator *key* may not do to people: reach platform administration through them. A key that
 * could grant the operator role, or take over an operator's account by re-issuing their invite, would
 * make itself a person with operator access and so outlive being revoked (it could also mint keys as
 * that person). Everything that does not hand out operator access stays available to keys, so a
 * provisioning program can still create and offboard the people of tenants.
 */
const KEY_CANNOT_ESCALATE = 'An operator key cannot grant the operator role or reset an operator\'s access: do that as a system admin'

const OPERATORS_NEED_SYSTEM_ADMIN = 'Only a system admin can grant the operator role or manage operators'
const SYSTEM_ADMIN_FROM_CLI = 'System admins are created and removed from the command line (pnpm system-admin:create), not through the API'

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
  /** The signed-in user acting, or null for a key. */
  actorUserId: string | null
  /** An operator key (not a person, not the admin key): see `KEY_CANNOT_ESCALATE`. */
  viaOperatorKey: boolean
  /** An operator or a system admin (or the admin key). */
  operator: boolean
  /** A system admin (or the admin key): the only rank that may administer operators. */
  systemAdmin: boolean
  /** Tenants a non-operator may administer people in. */
  managed: string[]
}

/**
 * Who may do what to whom when administering people. Every rule about users and memberships is
 * here, so the HTTP layer only translates results into status codes.
 *
 *  - A **system admin** (or the admin key) administers anyone except other system admins, who are
 *    created and removed from the command line only. They are the only rank that may grant the
 *    operator role or create, disable, re-invite or remove operators.
 *  - An **operator** sees everyone but changes only people who hold neither operator nor system_admin:
 *    in practice tenant managers, whom creating is their job. Nobody can grant `system_admin` here.
 *  - A **tenant manager** administers only people who belong *wholly* to tenants they manage:
 *    they hold a membership and every one of them is a manager role in one of those tenants. Anyone
 *    else (a person who also belongs to another tenant, any operator) is invisible to them (404),
 *    which also keeps a manager from taking over such an account by re-issuing its invite. They can
 *    never grant the operator role or a tenant they do not manage.
 *  - Nobody can disable themselves or strip their own operator role or last role; another
 *    administrator does that. The platform always keeps an active operator or system admin (enforced in UserStore).
 */
export class UserAdmin {
  constructor(
    private readonly users: UserStore,
    private readonly invites: InviteStore,
    /** Where administrative changes are written down. Optional so the rules can be tested alone. */
    private readonly audit?: AuditLog,
  ) {}

  /**
   * The audit entry for a change, to be written in the same transaction as the change (so no entry, no
   * change). None without an audit log.
   */
  private entry<R>(input: AuditInput | ((result: R) => AuditInput)): Within<R> | undefined {
    const audit = this.audit
    if (!audit) return undefined
    return (tx, result) => audit.recordStrict(typeof input === 'function' ? input(result) : input, tx)
  }

  /** The tenants a person belongs to: what an audit entry about them is filed under. */
  private tenantsOf(memberships: Array<{ tenantId: string | null }>): string[] {
    return [...new Set(memberships.flatMap((m) => (m.tenantId ? [m.tenantId] : [])))]
  }

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
      const denied = this.mayNotGrantRole(scope, membership)
      if (denied) return denied
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
      // strict: if the entry cannot be written the person is removed again just below and the caller gets an error
      await this.audit?.recordStrict({
        action: 'user.create',
        actor: auditActorOf(actor),
        tenantIds: this.tenantsOf(memberships),
        target: user.id,
        details: { email: user.email, roles: memberships.map((m) => ({ role: m.role, tenantId: m.tenantId })), invited: true },
      })
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
    const protectedTarget = this.mayNotChange(scope, target.value)
    if (protectedTarget) return protectedTarget

    try {
      // the entry is written in the same transaction: no entry, no change
      await this.users.setStatus(
        userId,
        status,
        this.entry({
          action: status === 'disabled' ? 'user.disable' : 'user.enable',
          actor: auditActorOf(actor),
          tenantIds: this.tenantsOf(target.value.memberships),
          target: userId,
          details: { email: target.value.email },
        }),
      )
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
    if (scope.operator && scope.actorUserId !== null && scope.actorUserId === userId && request.role === 'tenant_manager') {
      return fail('FORBIDDEN', 'An operator cannot grant themselves a tenant role; ask another operator to add the membership')
    }
    const denied = this.mayNotGrantRole(scope, request) ?? this.mayNotChange(scope, target.value)
    if (denied) return denied
    const invalid = await this.validateMembership(request)
    if (invalid) return invalid

    let created: Membership
    try {
      created = await this.users.addMembership(
        userId,
        request.role,
        request.tenantId,
        this.entry((m: Membership) => ({
          action: 'membership.add',
          actor: auditActorOf(actor),
          tenantIds: this.tenantsOf([m]),
          target: userId,
          details: { email: target.value.email, role: m.role, tenantId: m.tenantId },
        })),
      )
    } catch (err) {
      return this.fromStoreError(err)
    }
    return ok(created)
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
    const protectedTarget = this.mayNotChange(scope, target.value)
    if (protectedTarget) return protectedTarget

    try {
      await this.users.removeMembership(
        userId,
        membershipId,
        this.entry({
          action: 'membership.remove',
          actor: auditActorOf(actor),
          tenantIds: this.tenantsOf([membership]),
          target: userId,
          details: { email: target.value.email, role: membership.role, tenantId: membership.tenantId },
        }),
      )
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
    // A new invite is how an account is taken over: not an operator's unless by a system admin, never a system admin's
    const protectedTarget = this.mayNotChange(scope, target.value)
    if (protectedTarget) return protectedTarget

    const invite = await this.invites.create(
      userId,
      scope.actorUserId,
      this.entry({
        action: 'invite.create',
        actor: auditActorOf(actor),
        tenantIds: this.tenantsOf(target.value.memberships),
        target: userId,
        // for someone who already has a password this is a password reset
        details: { email: target.value.email, reset: target.value.hasPassword },
      }),
    )
    return ok({ user: target.value, invite })
  }

  // ─── rules ─────────────────────────────────────────────────────────────────

  private scopeOf(actor: Principal): Scope | Failure {
    if (actor.kind === 'apiKey') return fail('FORBIDDEN', 'API keys cannot administer people')
    const operator = isOperator(actor)
    const managed = managedTenantIds(actor)
    if (!operator && managed.length === 0) return fail('FORBIDDEN', 'Operator or tenant manager role required')
    return {
      actorUserId: actor.kind === 'user' ? actor.user.id : null,
      viaOperatorKey: actor.kind === 'operatorKey',
      operator,
      systemAdmin: isSystemAdmin(actor),
      managed,
    }
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

  /**
   * Why this actor may not hand out this role, if so. `system_admin` is never granted here; `operator`
   * only by a system admin (and never by a key, which would outlive being revoked).
   */
  private mayNotGrantRole(scope: Scope, request: MembershipRequest): Failure | null {
    if (request.role === 'system_admin') return fail('FORBIDDEN', SYSTEM_ADMIN_FROM_CLI)
    if (request.role !== 'operator') return null
    if (scope.viaOperatorKey) return fail('FORBIDDEN', KEY_CANNOT_ESCALATE)
    if (!scope.systemAdmin) return fail('FORBIDDEN', OPERATORS_NEED_SYSTEM_ADMIN)
    return null
  }

  /**
   * Why this actor may not change this person, if so. A system admin is changed from the command line
   * only; an operator only by a system admin. Seeing them (list, get) is not restricted.
   */
  private mayNotChange(scope: Scope, target: UserWithMemberships): Failure | null {
    if (target.memberships.some((m) => m.role === 'system_admin')) return fail('FORBIDDEN', SYSTEM_ADMIN_FROM_CLI)
    if (!scope.systemAdmin && scope.operator && target.memberships.some((m) => m.role === 'operator')) {
      return fail('FORBIDDEN', scope.viaOperatorKey ? KEY_CANNOT_ESCALATE : OPERATORS_NEED_SYSTEM_ADMIN)
    }
    return null
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
