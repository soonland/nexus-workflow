import { randomBytes } from 'node:crypto'
import type postgres from 'postgres'
import { normalizeEmail } from '../auth/email.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserStatus = 'active' | 'disabled'
export type MembershipRole = 'operator' | 'tenant_manager'

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
  /** Null for platform-wide roles (operator). */
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

  /** Disabling also ends all of the user's sessions. False if the user does not exist. */
  async setStatus(userId: string, status: UserStatus): Promise<boolean> {
    return this.sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as postgres.Sql
      const rows = await tx`UPDATE public.users SET status = ${status} WHERE id = ${userId} RETURNING id`
      if (rows.length === 0) return false
      if (status === 'disabled') await tx`DELETE FROM public.sessions WHERE user_id = ${userId}`
      return true
    })
  }

  // ─── Memberships ───────────────────────────────────────────────────────────

  /**
   * Grants a role. Idempotent: granting what the user already has returns the existing
   * membership. `operator` must have no tenant; `tenant_manager` needs one.
   */
  async addMembership(userId: string, role: MembershipRole, tenantId: string | null): Promise<Membership> {
    if (role === 'operator' && tenantId !== null) throw new UserInputError('An operator is platform-wide and cannot be tied to a tenant')
    if (role === 'tenant_manager' && tenantId === null) throw new UserInputError('A tenant manager needs a tenant')

    try {
      const inserted = await this.sql<Membership[]>`
        INSERT INTO public.memberships (id, user_id, role, tenant_id)
        VALUES (${randomBytes(16).toString('hex')}, ${userId}, ${role}, ${tenantId})
        ON CONFLICT DO NOTHING
        RETURNING ${this.sql.unsafe(MEMBERSHIP_COLUMNS)}
      `
      if (inserted[0]) return inserted[0]

      const existing = await this.sql<Membership[]>`
        SELECT ${this.sql.unsafe(MEMBERSHIP_COLUMNS)} FROM public.memberships
        WHERE user_id = ${userId} AND role = ${role} AND tenant_id IS NOT DISTINCT FROM ${tenantId}
      `
      // The conflict was another request granting the same role a moment ago; it is there now.
      if (!existing[0]) throw new Error('Unexpected: membership neither inserted nor found')
      return existing[0]
    } catch (err) {
      if (isPgError(err, '23503')) {
        throw new UserInputError(err.constraint_name?.includes('tenant') ? 'Tenant not found' : 'User not found')
      }
      throw err
    }
  }

  /** Removes one of the user's memberships. False if it does not exist or belongs to someone else. */
  async removeMembership(userId: string, membershipId: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM public.memberships WHERE id = ${membershipId} AND user_id = ${userId} RETURNING id`
    return rows.length > 0
  }

  async listMemberships(userId: string): Promise<Membership[]> {
    return this.sql<Membership[]>`
      SELECT ${this.sql.unsafe(MEMBERSHIP_COLUMNS)} FROM public.memberships
      WHERE user_id = ${userId} ORDER BY created_at ASC, id ASC
    `
  }
}
