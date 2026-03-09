/**
 * Parse a BPMN timer expression into a concrete `Date`.
 *
 * Supported formats:
 * - ISO 8601 datetime  e.g. "2025-06-01T09:00:00Z"
 * - ISO 8601 duration  e.g. "PT30S", "PT5M", "PT1H", "P1D", "P1Y2M3DT4H5M6S"
 *
 * `now` is the base instant for duration-relative expressions.
 * Throws if the expression cannot be parsed.
 */
export function parseTimerExpression(expr: string, now: Date): Date {
  const trimmed = expr.trim()

  // ISO 8601 date-time: starts with a 4-digit year
  if (/^\d{4}/.test(trimmed)) {
    const d = new Date(trimmed)
    if (!isNaN(d.getTime())) return d
  }

  // ISO 8601 duration: P[nY][nM][nW][nD][T[nH][nM][nS]]
  const match = trimmed.match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  )
  if (match) {
    const years   = Number(match[1] ?? 0)
    const months  = Number(match[2] ?? 0)
    const weeks   = Number(match[3] ?? 0)
    const days    = Number(match[4] ?? 0)
    const hours   = Number(match[5] ?? 0)
    const minutes = Number(match[6] ?? 0)
    const seconds = Number(match[7] ?? 0)

    const deltaMs =
      years   * 365.25 * 24 * 3600 * 1000 +
      months  *  30.44 * 24 * 3600 * 1000 +
      weeks   *      7 * 24 * 3600 * 1000 +
      days    *          24 * 3600 * 1000 +
      hours   *               3600 * 1000 +
      minutes *                 60 * 1000 +
      seconds *                      1000

    return new Date(now.getTime() + deltaMs)
  }

  throw new Error(`Cannot parse timer expression: "${expr}"`)
}
