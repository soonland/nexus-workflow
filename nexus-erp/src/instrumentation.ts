export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureTimesheetDefinitionDeployed, ensureProfileUpdateDefinitionDeployed } =
      await import('@/lib/bpmn/deploy')

    try {
      await ensureTimesheetDefinitionDeployed()
      await ensureProfileUpdateDefinitionDeployed()
    } catch (err) {
      console.error('[instrumentation] Failed to deploy BPMN definition:', err)
    }

    if (process.env.REDIS_URL) {
      const { startRedisConsumer } = await import('@/lib/redisConsumer')
      startRedisConsumer(process.env.REDIS_URL).catch((err) => {
        console.error('[instrumentation] Redis consumer failed to start:', err)
      })
    }
  }
}
