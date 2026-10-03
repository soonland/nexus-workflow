import type postgres from 'postgres'
import { InviteStore } from '../db/InviteStore.js'
import { UserInputError, UserStore, type User } from '../db/UserStore.js'
import { normalizeEmail } from './email.js'

export interface CreateOperatorConfig {
  /** Keys the hash stored in place of the invite token (the server's API_KEY_HMAC_SECRET). */
  hmacSecret: string
  inviteTtlMs: number
}

export interface CreatedOperator {
  user: User
  /** False when the account already existed (it was made an operator and invited again). */
  created: boolean
  invite: { token: string; expiresAt: Date }
}

/**
 * Makes `email` an operator and issues them an invite to choose a password. This is how the first
 * operator comes into being (nobody can invite them), and the way back in if every operator is
 * locked out: it needs database access, not a signed-in user. Safe to repeat: an existing account is
 * kept (and re-enabled if it was disabled), it gains the operator role once, and the new invite
 * replaces any earlier one.
 */
export async function createOperatorWithInvite(
  sql: postgres.Sql,
  config: CreateOperatorConfig,
  input: { email: string; name?: string },
): Promise<CreatedOperator> {
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
  await users.addMembership(user.id, 'operator', null)
  const invite = await invites.create(user.id, null)
  return { user, created, invite }
}
