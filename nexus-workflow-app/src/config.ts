export const config = {
  port: Number(process.env['PORT'] ?? 3000),
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  /** Milliseconds to wait for in-flight work to drain before forcing exit. Default: 10 s. */
  shutdownTimeoutMs: Number(process.env['SHUTDOWN_TIMEOUT_MS'] ?? 10_000),
  /** Milliseconds before a request is aborted with 408. Default: 30 s. */
  requestTimeoutMs: Number(process.env['REQUEST_TIMEOUT_MS'] ?? 30_000),
}
