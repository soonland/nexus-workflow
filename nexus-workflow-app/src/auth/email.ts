const MAX_EMAIL_LENGTH = 254 // RFC 5321 limit for an address
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/

/**
 * Canonical form of an email address: trimmed and lower-cased, so the same address is the same
 * account however it was typed. Returns null if it is not a plausible address (the real check is
 * the invite link that is sent to it).
 */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase()
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null
  return EMAIL_SHAPE.test(email) ? email : null
}
