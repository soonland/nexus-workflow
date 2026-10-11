import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeOrigin } from './auth/origin.js'
import { describeAllowListProblem, parseAllowedHostsEnv } from './webhooks/urlPolicy.js'

const nodeEnv = process.env['NODE_ENV'] ?? 'development'

// The built operator console (`pnpm --filter nexus-workflow-console build`). The default is the
// sibling package, which is right both for `tsx src/main.ts` and for the compiled dist/main.js.
const defaultConsoleDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../nexus-workflow-console/dist')

const publicOrigin = normalizeOrigin(process.env['PUBLIC_ORIGIN'])

function parseTrustedProxies(value: string | undefined): number {
  if (!value || value === 'false') return 0
  if (value === 'true') return 1
  return /^\d+$/.test(value) ? Number(value) : Number.NaN
}

/** Shortest ADMIN_API_KEY accepted in production. */
export const ADMIN_API_KEY_MIN_LENGTH = 16

export const config = {
  port: Number(process.env['PORT'] ?? 3000),
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow',
  nodeEnv,
  redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  /** Milliseconds to wait for in-flight work to drain before forcing exit. Default: 10 s. */
  shutdownTimeoutMs: Number(process.env['SHUTDOWN_TIMEOUT_MS'] ?? 10_000),
  /** Milliseconds before a request is aborted with 408. Default: 30 s. */
  requestTimeoutMs: Number(process.env['REQUEST_TIMEOUT_MS'] ?? 30_000),
  /**
   * Break-glass operator credential. Optional and best left unset in production once operators can
   * sign in; the normal way in is a person or a named, revocable operator key.
   */
  adminApiKey: process.env['ADMIN_API_KEY'] ?? '',
  /** HMAC-SHA256 secret used to hash API keys before storing/comparing. Must be set in production. */
  apiKeyHmacSecret: process.env['API_KEY_HMAC_SECRET'] ?? '',
  /** Directory with the built operator console, served at /console when it exists. */
  consoleDir: process.env['CONSOLE_DIR'] ?? defaultConsoleDir,
  /** A signed-in session unused for this long ends. Default: 8 hours. */
  sessionIdleMs: Number(process.env['SESSION_IDLE_MINUTES'] ?? 480) * 60_000,
  /** A session ends this long after sign-in however busy it was. Default: 7 days. */
  sessionMaxMs: Number(process.env['SESSION_MAX_DAYS'] ?? 7) * 86_400_000,
  /** How long an invitation link stays valid. Default: 7 days. */
  inviteTtlMs: Number(process.env['INVITE_TTL_HOURS'] ?? 168) * 3_600_000,
  /**
   * The origin the console is served from (for example https://workflow.example.com), normalised to
   * the exact form a browser sends in its Origin header (no trailing slash or path, lower case).
   * Used to check the Origin of sign-in requests and to build absolute invite links. Set it behind a
   * proxy that rewrites the host.
   */
  publicOrigin: publicOrigin.ok ? publicOrigin.origin : undefined,
  /** The raw PUBLIC_ORIGIN when it is not a usable http(s) origin; assertConfigValid refuses to start. */
  publicOriginInvalid: publicOrigin.ok ? undefined : process.env['PUBLIC_ORIGIN'],
  /**
   * How many proxies of yours sit in front of this server: 0 (default), `true` (= 1) or a number.
   * Above 0, X-Forwarded-For / X-Forwarded-Proto are believed. Only set it behind proxies you control.
   */
  trustedProxies: parseTrustedProxies(process.env['TRUST_PROXY']),
  /** Accept plain http:// webhook targets. Off by default; for local development only. */
  webhookAllowHttp: process.env['WEBHOOK_ALLOW_HTTP'] === 'true',
  /**
   * Internal webhook targets to allow (comma separated hostnames, addresses or CIDR ranges).
   * Webhooks are otherwise refused when they point at loopback, private or link-local addresses.
   */
  webhookAllowedHosts: parseAllowedHostsEnv(process.env['WEBHOOK_ALLOWED_HOSTS']),
}

/**
 * Validates the config and exits the process (in production) or warns (in development)
 * if required values are missing. Call this explicitly in main.ts after importing config.
 */
export function assertConfigValid(cfg: typeof config) {
  // ADMIN_API_KEY is break-glass: one shared secret with full operator power that never expires.
  // Unset, it matches nothing, which is the intended state of a running production system.
  if (cfg.adminApiKey) {
    const production = cfg.nodeEnv === 'production'
    if (cfg.adminApiKey.length < ADMIN_API_KEY_MIN_LENGTH) {
      const message = `[config] ADMIN_API_KEY is shorter than ${ADMIN_API_KEY_MIN_LENGTH} characters. Use a random secret (e.g. openssl rand -hex 32).`
      if (production) {
        console.error(`${message} Exiting.`)
        process.exit(1)
      }
      console.warn(message)
    }
    if (production) {
      console.warn(
        '[config] ADMIN_API_KEY is set in production. It is a shared, non-expiring break-glass credential: ' +
          'once an operator can sign in and create operator keys, unset it, and set it again only to recover.',
      )
    }
  }

  if (cfg.publicOriginInvalid !== undefined) {
    console.error(
      `[config] PUBLIC_ORIGIN must be an http(s) origin such as https://workflow.example.com, got "${cfg.publicOriginInvalid}". Exiting.`,
    )
    process.exit(1)
  }

  if (Number.isNaN(cfg.trustedProxies)) {
    console.error('[config] TRUST_PROXY must be true, false or the number of proxies in front of this server. Exiting.')
    process.exit(1)
  }

  const allowListProblem = describeAllowListProblem(cfg.webhookAllowedHosts)
  if (allowListProblem) {
    console.error(`[config] WEBHOOK_ALLOWED_HOSTS: ${allowListProblem}. Exiting.`)
    process.exit(1)
  }

  const positive = (n: number) => Number.isFinite(n) && n > 0
  if (!positive(cfg.sessionIdleMs) || !positive(cfg.sessionMaxMs) || !positive(cfg.inviteTtlMs)) {
    console.error('[config] SESSION_IDLE_MINUTES, SESSION_MAX_DAYS and INVITE_TTL_HOURS must be positive numbers. Exiting.')
    process.exit(1)
  }

  if (!cfg.apiKeyHmacSecret && cfg.nodeEnv === 'production') {
    console.error('[config] API_KEY_HMAC_SECRET is required in production. Set it to a secret key (e.g. openssl rand -hex 32). Exiting.')
    process.exit(1)
  } else if (!cfg.apiKeyHmacSecret) {
    console.warn('[config] API_KEY_HMAC_SECRET is not set — API key hashing uses an empty secret (dev only).')
  }
}
