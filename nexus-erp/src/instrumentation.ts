export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureTimesheetDefinitionDeployed } = await import('@/lib/bpmn/deploy')

    try {
      await ensureTimesheetDefinitionDeployed()
    } catch (err) {
      console.error('[instrumentation] Failed to deploy BPMN definition:', err)
    }
  }
}
