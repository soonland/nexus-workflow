export type NormalizedOrigin = { ok: true; origin: string | undefined } | { ok: false }

/**
 * Turns the configured public origin (PUBLIC_ORIGIN) into exactly the form a browser puts in the
 * `Origin` header: lower-case scheme and host, no default port, no trailing slash, no path. The
 * CSRF check compares the two as strings, so `https://example.com/` or `HTTPS://Example.com` would
 * otherwise never match and every sign-in from the browser would fail with a 403.
 *
 * An unset or empty value means "not configured". Anything that is not an http(s) origin without
 * credentials is rejected, so a typo is caught at startup.
 */
export function normalizeOrigin(value: string | undefined): NormalizedOrigin {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return { ok: true, origin: undefined }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false }
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
    return { ok: false }
  }
  return { ok: true, origin: url.origin }
}
