import { timingSafeEqual } from 'node:crypto'

/**
 * Whether an `Authorization` header carries the platform admin key (`Bearer <key>`). The comparison
 * does not leak how much of the key was right, and an unset admin key matches nothing.
 */
export function isAdminKeyHeader(authHeader: string | undefined, adminApiKey: string): boolean {
  if (!authHeader || adminApiKey === '') return false
  const [scheme, key] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !key) return false
  try {
    return timingSafeEqual(Buffer.from(key), Buffer.from(adminApiKey))
  } catch {
    // Buffers of different lengths throw — treat as mismatch
    return false
  }
}
