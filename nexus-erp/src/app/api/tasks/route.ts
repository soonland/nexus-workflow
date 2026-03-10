import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { listTasks } from '@/lib/workflow'
import { db } from '@/db/client'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const page = Number(searchParams.get('page') ?? 0)
  const pageSize = Number(searchParams.get('pageSize') ?? 20)

  // Fetch tasks assigned directly to this user
  const personalResult = await listTasks({
    assignee: session.user.id,
    status: 'open',
    page,
    pageSize,
  })

  // If this user is in the HR department, also fetch HR group tasks
  const employee = await db.employee.findUnique({
    where: { userId: session.user.id },
    select: { departmentId: true },
  })

  let allItems = personalResult.items

  if (employee?.departmentId) {
    const deptResult = await listTasks({
      assignee: `dept:${employee.departmentId}`,
      status: 'open',
      page,
      pageSize,
    })
    // Merge, deduplicating by task id
    const seen = new Set(personalResult.items.map((t) => t.id))
    for (const task of deptResult.items) {
      if (!seen.has(task.id)) allItems.push(task)
    }
  }

  // Enrich with timesheet data using workflowInstanceId
  const enriched = await Promise.all(
    allItems.map(async (task) => {
      const ts = await db.timesheet.findFirst({
        where: { workflowInstanceId: task.instanceId },
        include: { employee: { include: { user: { select: { email: true } } } } },
      })
      return { ...task, timesheet: ts ?? null }
    }),
  )

  return NextResponse.json({ ...personalResult, items: enriched, total: enriched.length })
}
