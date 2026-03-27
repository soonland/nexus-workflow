const rawApiKeys = process.env['API_KEYS'] ?? ''
const apiKeys = rawApiKeys.split(',').map(k => k.trim()).filter(Boolean)

const nodeEnv = process.env['NODE_ENV'] ?? 'development'

if (apiKeys.length === 0) {
  if (nodeEnv === 'production') {
    console.error('[config] API_KEYS is required in production. Set a comma-separated list of keys (e.g. openssl rand -hex 32). Exiting.')
    process.exit(1)
  } else {
    console.warn('[config] API_KEYS is not set — all requests will be rejected with 401. Set API_KEYS to enable access.')
  }
}

export const config = {
  port: Number(process.env['PORT'] ?? 3000),
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow',
  nodeEnv,
  redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  /** Milliseconds to wait for in-flight work to drain before forcing exit. Default: 10 s. */
  shutdownTimeoutMs: Number(process.env['SHUTDOWN_TIMEOUT_MS'] ?? 10_000),
  /** Milliseconds before a request is aborted with 408. Default: 30 s. */
  requestTimeoutMs: Number(process.env['REQUEST_TIMEOUT_MS'] ?? 30_000),
  /** Valid API keys read from API_KEYS env var (comma-separated). */
  apiKeys,
}
