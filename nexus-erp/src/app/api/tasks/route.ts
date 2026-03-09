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

  const result = await listTasks({
    assignee: session.user.id,
    status: 'open',
    page,
    pageSize,
  })

  // Enrich with timesheet data using workflowInstanceId
  const enriched = await Promise.all(
    result.items.map(async (task) => {
      const ts = await db.timesheet.findFirst({
        where: { workflowInstanceId: task.instanceId },
        include: { employee: { include: { user: { select: { email: true } } } } },
      })
      return { ...task, timesheet: ts ?? null }
    }),
  )

  return NextResponse.json({ ...result, items: enriched })
}
