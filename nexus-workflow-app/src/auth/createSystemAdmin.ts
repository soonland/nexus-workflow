import type postgres from 'postgres'
import { InviteStore } from '../db/InviteStore.js'
import { UserInputError, UserStore, type User } from '../db/UserStore.js'
import { normalizeEmail } from './email.js'

export interface CreateSystemAdminConfig {
  /** Keys the hash stored in place of the invite token (the server's API_KEY_HMAC_SECRET). */
  hmacSecret: string
  inviteTtlMs: number
}

export interface CreatedSystemAdmin {
  user: User
  /** False when the account already existed (it was made a system admin and invited again). */
  created: boolean
  invite: { token: string; expiresAt: Date }
}

/**
 * Makes `email` a system admin and issues them an invite to choose a password. The system admin role
 * cannot be granted through the API or the console, so this command line (which needs database access,
 * not a signed-in user) is the only way to create one, and the way back in if access is lost. Safe to
 * repeat, and it can be run for several people: an existing account is kept (and re-enabled if it
 * was disabled), gains the role once, and the new invite replaces any earlier one.
 */
export async function createSystemAdminWithInvite(
  sql: postgres.Sql,
  config: CreateSystemAdminConfig,
  input: { email: string; name?: string },
): Promise<CreatedSystemAdmin> {
  const email = normalizeEmail(input.email)
  if (!email) throw new UserInputError('Invalid email address')

  const users = new UserStore(sql)
  const invites = new InviteStore(sql, { hmacSecret: config.hmacSecret, ttlMs: config.inviteTtlMs })

  let user = await users.findByEmail(email)
  const created = user === null
  user ??= await users.createUser({ email, name: input.name?.trim() || email.split('@')[0] || email })

  if (user.status !== 'active') {
    await users.setStatus(user.id, 'active')
    user = (await users.findById(user.id)) ?? user
  }
  await users.addMembership(user.id, 'system_admin', null)
  const invite = await invites.create(user.id, null)
  return { user, created, invite }
}

/**
 * Takes the system admin role away from `email`. The account and its other roles stay. Refused when
 * they are the last active operator or system admin (LastOperatorError).
 */
export async function removeSystemAdmin(sql: postgres.Sql, input: { email: string }): Promise<{ user: User; removed: boolean }> {
  const users = new UserStore(sql)
  const user = await users.findByEmail(input.email)
  if (!user) throw new UserInputError('No user with this email')

  const membership = (await users.listMemberships(user.id)).find((m) => m.role === 'system_admin')
  if (!membership) return { user, removed: false }
  await users.removeMembership(user.id, membership.id)
  return { user, removed: true }
}
