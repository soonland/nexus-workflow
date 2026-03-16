export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const {
      ensureTimesheetDefinitionDeployed,
      ensureProfileUpdateDefinitionDeployed,
      ensureOrgStatusChangeDefinitionDeployed,
      ensureExpenseDefinitionDeployed,
    } = await import('@/lib/bpmn/deploy')

    try {
      await ensureTimesheetDefinitionDeployed()
      await ensureProfileUpdateDefinitionDeployed()
      await ensureOrgStatusChangeDefinitionDeployed()
      await ensureExpenseDefinitionDeployed()
    } catch (err) {
      console.error('[instrumentation] Failed to deploy BPMN definition:', err)
    }

    // Seed predefined permissions so they always exist in the DB
    try {
      const { db } = await import('@/db/client')
      const { RESOURCES, CRUD_ACTIONS, RESOURCE_LABELS, ACTION_LABELS, WORKFLOW_PERMISSIONS } = await import('@/lib/permissions')
      const crudPerms = RESOURCES.flatMap((r) =>
        CRUD_ACTIONS.map((a) => ({
          key: `${r}:${a}`,
          label: `${RESOURCE_LABELS[r]} — ${ACTION_LABELS[a]}`,
          type: 'crud' as const,
        }))
      )
      const workflowPerms = Object.entries(WORKFLOW_PERMISSIONS).map(([key, label]) => ({
        key,
        label,
        type: 'workflow' as const,
      }))
      await Promise.all(
        [...crudPerms, ...workflowPerms].map(({ key, label, type }) =>
          db.permission.upsert({
            where: { key },
            update: { label, type },
            create: { key, label, type },
          })
        )
      )
    } catch (err) {
      console.error('[instrumentation] Failed to seed permissions:', err)
    }

    if (process.env.REDIS_URL) {
      const { startRedisConsumer } = await import('@/lib/redisConsumer')
      startRedisConsumer(process.env.REDIS_URL).catch((err) => {
        console.error('[instrumentation] Redis consumer failed to start:', err)
      })
    }
  }
}
