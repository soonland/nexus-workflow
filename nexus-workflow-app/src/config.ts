export const config = {
  port: Number(process.env['PORT'] ?? 3000),
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
}
