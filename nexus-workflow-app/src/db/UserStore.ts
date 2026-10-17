import { randomBytes } from 'node:crypto'
import type postgres from 'postgres'
import { normalizeEmail } from '../auth/email.js'
import { atomically, type Within } from './atomically.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserStatus = 'active' | 'disabled'
export type MembershipRole = 'system_admin' | 'operator' | 'tenant_manager'

/** The roles that administer the platform itself; the platform always keeps one active holder. */
const PLATFORM_ROLES: readonly MembershipRole[] = ['system_admin', 'operator']

/** A user as the rest of the app sees it: never carries the password hash. */
export interface User {
  id: string
  email: string
  name: string
  status: UserStatus
  createdAt: Date
  lastLoginAt: Date | null
  hasPassword: boolean
}

/** What signing in needs. Only returned by findCredentialsByEmail. */
export interface UserCredentials {
  id: string
  email: string
  status: UserStatus
  passwordHash: string | null
}

export interface Membership {
  id: string
  userId: string
  role: MembershipRole
  /** Null for platform-wide roles (system_admin, operator). */
  tenantId: string | null
  createdAt: Date
}

export interface CreateUserInput {
  email: string
  name: string
  /** A hash from PasswordHasher. Omit for a user who will set it when accepting an invite. */
  passwordHash?: string
}

/** The input was not acceptable (the message is safe to show to an operator). */
export class UserInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserInputError'
  }
}

/** The change would leave the platform without an active operator or system admin. */
export class LastOperatorError extends UserInputError {
  constructor() {
    super('The platform needs at least one active operator or system admin')
    this.name = 'LastOperatorError'
  }
}

export type UserWithMemberships = User & { memberships: Membership[] }

export class EmailTakenError extends UserInputError {
  constructor() {
    super('A user with this email already exists')
    this.name = 'EmailTakenError'
  }
}

const USER_COLUMNS = `
  id, email, name, status,
  created_at AS "createdAt",
  last_login_at AS "lastLoginAt",
  (password_hash IS NOT NULL) AS "hasPassword"
`

const MEMBERSHIP_COLUMNS = `id, user_id AS "userId", role, tenant_id AS "tenantId", created_at AS "createdAt"`

// Changes that could remove the last platform administrator take this lock, so two of them racing
// cannot both look at "there are two" and each remove one.
const OPERATOR_LOCK_KEY = 7_313_001

/**
 * Throws if the change would leave the platform without an active operator or system admin: the user
 * is one now, would stop being one, and nobody else active is. A disable (no `exceptMembershipId`) takes
 * all the user's platform roles; removing one membership leaves the others. Call under the lock.
 */
async function assertNotLastAdmin(tx: postgres.Sql, userId: string, removal: { exceptMembershipId?: string } = {}): Promise<void> {
  const [row] = await tx<{ isActiveAdmin: boolean; keepsRole: boolean; otherActiveAdmins: number }[]>`
    SELECT
      EXISTS (
        SELECT 1 FROM public.memberships m JOIN public.users u ON u.id = m.user_id
        WHERE m.user_id = ${userId} AND m.role = ANY(${tx.array([...PLATFORM_ROLES])}) AND u.status = 'active'
      ) AS "isActiveAdmin",
      EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id = ${userId} AND m.role = ANY(${tx.array([...PLATFORM_ROLES])}) AND m.id IS DISTINCT FROM ${removal.exceptMembershipId ?? null}
      ) AS "keepsRole",
      (
        SELECT count(DISTINCT m.user_id)::int FROM public.memberships m JOIN public.users u ON u.id = m.user_id
        WHERE m.user_id <> ${userId} AND m.role = ANY(${tx.array([...PLATFORM_ROLES])}) AND u.status = 'active'
      ) AS "otherActiveAdmins"
  `
  if (row?.isActiveAdmin && row.otherActiveAdmins === 0 && !(removal.exceptMembershipId !== undefined && row.keepsRole)) throw new LastOperatorError()
}

function isPgError(err: unknown, code: string): err is { code: string; constraint_name?: string } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code
}

// ─── UserStore ────────────────────────────────────────────────────────────────

export class UserStore {
  constructor(private readonly sql: postgres.Sql) {}

  // ─── Users ─────────────────────────────────────────────────────────────────

  async createUser(input: CreateUserInput): Promise<User> {
    const email = normalizeEmail(input.email)
    if (!email) throw new UserInputError('Invalid email address')
    const name = input.name.trim()
    if (name === '') throw new UserInputError('Name is required')
    if (name.length > 255) throw new UserInputError('Name must not exceed 255 characters')

    try {
      const rows = await this.sql<User[]>`
        INSERT INTO public.users (id, email, name, password_hash)
        VALUES (${randomBytes(16).toString('hex')}, ${email}, ${name}, ${input.passwordHash ?? null})
        RETURNING ${this.sql.unsafe(USER_COLUMNS)}
      `
      const user = rows[0]
      if (!user) throw new Error('Unexpected: INSERT INTO users returned no rows')
      return user
    } catch (err) {
      if (isPgError(err, '23505')) throw new EmailTakenError()
      throw err
    }
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.sql<User[]>`SELECT ${this.sql.unsafe(USER_COLUMNS)} FROM public.users WHERE id = ${id}`
    return rows[0] ?? null
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalized = normalizeEmail(email)
    if (!normalized) return null
    const rows = await this.sql<User[]>`SELECT ${this.sql.unsafe(USER_COLUMNS)} FROM public.users WHERE email = ${normalized}`
    return rows[0] ?? null
  }

  /** For signing in: the only way to read a password hash. */
  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const normalized = normalizeEmail(email)
    if (!normalized) return null
    const rows = await this.sql<UserCredentials[]>`
      SELECT id, email, status, password_hash AS "passwordHash" FROM public.users WHERE email = ${normalized}
    `
    return rows[0] ?? null
  }

  async listUsers(): Promise<User[]> {
    return this.sql<User[]>`SELECT ${this.sql.unsafe(USER_COLUMNS)} FROM public.users ORDER BY created_at ASC, id ASC`
  }

  /** Notes that the user just signed in. */
  async recordLogin(userId: string): Promise<void> {
    await this.sql`UPDATE public.users SET last_login_at = now() WHERE id = ${userId}`
  }

  /** Sets a new password hash and ends all of the user's sessions. False if the user does not exist. */
  async setPassword(userId: string, passwordHash: string): Promise<boolean> {
    return this.sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as postgres.Sql
      const rows = await tx`UPDATE public.users SET password_hash = ${passwordHash} WHERE id = ${userId} RETURNING id`
      if (rows.length === 0) return false
      await tx`DELETE FROM public.sessions WHERE user_id = ${userId}`
      return true
    })
  }

  /**
   * Disabling also ends all of the user's sessions. Disabling the last active operator or system admin is
   * refused (LastOperatorError). False if the user does not exist. `within` runs in the same transaction.
   */
  async setStatus(userId: string, status: UserStatus, within?: Within<true>): Promise<boolean> {
    return this.sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as postgres.Sql
      if (status === 'disabled') {
        await tx`SELECT pg_advisory_xact_lock(${OPERATOR_LOCK_KEY})`
        await assertNotLastAdmin(tx, userId)
      }
      const rows = await tx`UPDATE public.users SET status = ${status} WHERE id = ${userId} RETURNING id`
      if (rows.length === 0) return false
      if (status === 'disabled') await tx`DELETE FROM public.sessions WHERE user_id = ${userId}`
      await within?.(tx, true)
      return true
    })
  }

  /** Removes a user and everything that hangs off them (memberships, sessions, invites). */
  async deleteUser(userId: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM public.users WHERE id = ${userId} RETURNING id`
    return rows.length > 0
  }

  async tenantExists(tenantId: string): Promise<boolean> {
    const rows = await this.sql`SELECT 1 FROM public.tenants WHERE id = ${tenantId}`
    return rows.length > 0
  }

  // ─── Listing ───────────────────────────────────────────────────────────────

  /**
   * Users with their memberships, oldest first. With `withinTenants`, only the users that belong
   * wholly inside those tenants: they have a membership, and every membership is a tenant manager
   * role in one of them. That is the set a tenant manager may see and administer; anyone who also
   * holds another tenant or the operator role is out of their reach.
   */
  async listWithMemberships(filter: { withinTenants?: string[] } = {}): Promise<UserWithMemberships[]> {
    const within = filter.withinTenants
    if (within && within.length === 0) return []

    const users = within
      ? await this.sql<User[]>`
          SELECT ${this.sql.unsafe(USER_COLUMNS)} FROM public.users u
          WHERE ${this.withinTenantsPredicate(within)}
          ORDER BY created_at ASC, id ASC`
      : await this.sql<User[]>`SELECT ${this.sql.unsafe(USER_COLUMNS)} FROM public.users ORDER BY created_at ASC, id ASC`
    return this.attachMemberships(users)
  }

  async getWithMemberships(userId: string): Promise<UserWithMemberships | null> {
    const user = await this.findById(userId)
    return user ? (await this.attachMemberships([user]))[0] ?? null : null
  }

  /** Whether the user belongs wholly inside the given tenants (see listWithMemberships). */
  async isWithinTenants(userId: string, tenantIds: string[]): Promise<boolean> {
    if (tenantIds.length === 0) return false
    const rows = await this.sql`
      SELECT 1 FROM public.users u WHERE u.id = ${userId} AND ${this.withinTenantsPredicate(tenantIds)}`
    return rows.length > 0
  }

  private withinTenantsPredicate(tenantIds: string[]) {
    return this.sql`
      EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = u.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id = u.id
          AND NOT (m.role = 'tenant_manager' AND m.tenant_id = ANY(${this.sql.array(tenantIds)}))
      )`
  }

  private async attachMemberships(users: User[]): Promise<UserWithMemberships[]> {
    if (users.length === 0) return []
    const memberships = await this.sql<Membership[]>`
      SELECT ${this.sql.unsafe(MEMBERSHIP_COLUMNS)} FROM public.memberships
      WHERE user_id = ANY(${this.sql.array(users.map((u) => u.id))})
      ORDER BY created_at ASC, id ASC`
    const byUser = new Map<string, Membership[]>()
    for (const m of memberships) byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m])
    return users.map((user) => ({ ...user, memberships: byUser.get(user.id) ?? [] }))
  }

  // ─── Memberships ───────────────────────────────────────────────────────────

  /**
   * Grants a role. Idempotent: granting what the user already has returns the existing
   * membership. `system_admin` and `operator` must have no tenant; `tenant_manager` needs one. `within` runs in the same
   * transaction as the grant.
   */
  async addMembership(userId: string, role: MembershipRole, tenantId: string | null, within?: Within<Membership>): Promise<Membership> {
    if (role !== 'tenant_manager' && tenantId !== null) throw new UserInputError('An operator or system admin is platform-wide and cannot be tied to a tenant')
    if (role === 'tenant_manager' && tenantId === null) throw new UserInputError('A tenant manager needs a tenant')

    try {
      return await atomically(
        this.sql,
        async (db) => {
          const inserted = await db<Membership[]>`
            INSERT INTO public.memberships (id, user_id, role, tenant_id)
            VALUES (${randomBytes(16).toString('hex')}, ${userId}, ${role}, ${tenantId})
            ON CONFLICT DO NOTHING
            RETURNING ${db.unsafe(MEMBERSHIP_COLUMNS)}
          `
          if (inserted[0]) return inserted[0]

          const existing = await db<Membership[]>`
            SELECT ${db.unsafe(MEMBERSHIP_COLUMNS)} FROM public.memberships
            WHERE user_id = ${userId} AND role = ${role} AND tenant_id IS NOT DISTINCT FROM ${tenantId}
          `
          // The conflict was another request granting the same role a moment ago; it is there now.
          if (!existing[0]) throw new Error('Unexpected: membership neither inserted nor found')
          return existing[0]
        },
        within,
      )
    } catch (err) {
      if (isPgError(err, '23503')) {
        throw new UserInputError(err.constraint_name?.includes('tenant') ? 'Tenant not found' : 'User not found')
      }
      throw err
    }
  }

  /**
   * Removes one of the user's memberships. Removing the platform role of the last active
   * operator or system admin is refused (LastOperatorError). False if it does not exist or belongs to someone else.
   * `within` runs in the same transaction, only if a membership was removed.
   */
  async removeMembership(userId: string, membershipId: string, within?: Within<true>): Promise<boolean> {
    return this.sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as postgres.Sql
      await tx`SELECT pg_advisory_xact_lock(${OPERATOR_LOCK_KEY})`
      const found = await tx<{ role: MembershipRole }[]>`
        SELECT role FROM public.memberships WHERE id = ${membershipId} AND user_id = ${userId}`
      if (!found[0]) return false
      if (PLATFORM_ROLES.includes(found[0].role)) await assertNotLastAdmin(tx, userId, { exceptMembershipId: membershipId })
      const rows = await tx`DELETE FROM public.memberships WHERE id = ${membershipId} AND user_id = ${userId} RETURNING id`
      if (rows.length === 0) return false
      await within?.(tx, true)
      return true
    })
  }

  async listMemberships(userId: string): Promise<Membership[]> {
    return this.sql<Membership[]>`
      SELECT ${this.sql.unsafe(MEMBERSHIP_COLUMNS)} FROM public.memberships
      WHERE user_id = ${userId} ORDER BY created_at ASC, id ASC
    `
  }
}
