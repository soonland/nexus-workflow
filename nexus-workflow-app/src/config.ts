const nodeEnv = process.env['NODE_ENV'] ?? 'development'

export const config = {
  port: Number(process.env['PORT'] ?? 3000),
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow',
  nodeEnv,
  redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  /** Milliseconds to wait for in-flight work to drain before forcing exit. Default: 10 s. */
  shutdownTimeoutMs: Number(process.env['SHUTDOWN_TIMEOUT_MS'] ?? 10_000),
  /** Milliseconds before a request is aborted with 408. Default: 30 s. */
  requestTimeoutMs: Number(process.env['REQUEST_TIMEOUT_MS'] ?? 30_000),
  /** Bootstrap API key for initial tenant/key setup (dev and first-run). Never used for runtime auth. */
  adminApiKey: process.env['ADMIN_API_KEY'] ?? '',
  /** HMAC-SHA256 secret used to hash API keys before storing/comparing. Must be set in production. */
  apiKeyHmacSecret: process.env['API_KEY_HMAC_SECRET'] ?? '',
}

/**
 * Validates the config and exits the process (in production) or warns (in development)
 * if required values are missing. Call this explicitly in main.ts after importing config.
 */
export function assertConfigValid(cfg: typeof config) {
  if (!cfg.adminApiKey && cfg.nodeEnv === 'production') {
    console.error('[config] ADMIN_API_KEY is required in production. Set it to a secret key (e.g. openssl rand -hex 32). Exiting.')
    process.exit(1)
  } else if (!cfg.adminApiKey) {
    console.warn('[config] ADMIN_API_KEY is not set — bootstrap key unavailable.')
  }

  if (!cfg.apiKeyHmacSecret && cfg.nodeEnv === 'production') {
    console.error('[config] API_KEY_HMAC_SECRET is required in production. Set it to a secret key (e.g. openssl rand -hex 32). Exiting.')
    process.exit(1)
  } else if (!cfg.apiKeyHmacSecret) {
    console.warn('[config] API_KEY_HMAC_SECRET is not set — API key hashing uses an empty secret (dev only).')
  }
}
