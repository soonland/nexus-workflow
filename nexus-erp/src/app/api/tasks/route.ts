import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { listTasks } from '@/lib/workflow'
import { db } from '@/db/client'
import { getEffectivePermissions } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const page = Number(searchParams.get('page') ?? 0)
  const pageSize = Number(searchParams.get('pageSize') ?? 20)

  // Build all assignee patterns this user matches (including group-inherited permissions)
  const effectivePerms = await getEffectivePermissions(session.user.id, db)
  const patterns = [
    session.user.id,
    `role:${session.user.role}`,
    ...effectivePerms.map((key) => `perm:${key}`),
  ]

  // Fetch tasks for all patterns in parallel, deduplicate by id
  const results = await Promise.all(
    patterns.map((a) => listTasks({ assignee: a, status: 'open', page, pageSize })),
  )
  const seen = new Set<string>()
  const allItems = results.flatMap((r) => r.items).filter((t) => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })

  // Enrich with entity data using workflowInstanceId
  const enriched = await Promise.all(
    allItems.map(async (task) => {
      // Try timesheet first
      const timesheet = await db.timesheet.findFirst({
        where: { workflowInstanceId: task.instanceId },
        include: { employee: { include: { user: { select: { email: true } } } } },
      })
      if (timesheet) {
        return { ...task, entityType: 'timesheet' as const, entity: timesheet, timesheet }
      }

      // Try organization
      const organization = await db.organization.findFirst({
        where: { workflowInstanceId: task.instanceId },
      })
      if (organization) {
        return { ...task, entityType: 'organization' as const, entity: organization, timesheet: null }
      }

      // Try employee profile update request
      const profileRequest = await db.employeeProfileUpdateRequest.findFirst({
        where: { workflowInstanceId: task.instanceId },
        include: { employee: { select: { fullName: true, userId: true } } },
      })
      if (profileRequest) {
        return { ...task, entityType: 'profileUpdateRequest' as const, entity: profileRequest, timesheet: null }
      }

      return { ...task, entityType: null, entity: null, timesheet: null }
    }),
  )

  return NextResponse.json({ items: enriched, total: enriched.length, page, pageSize })
}
