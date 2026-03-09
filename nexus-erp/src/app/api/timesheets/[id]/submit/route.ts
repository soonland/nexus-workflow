import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { startInstance } from '@/lib/workflow'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const ts = await db.timesheet.findUnique({
    where: { id },
    include: {
      employee: {
        include: {
          manager: {
            include: { user: { select: { id: true } } },
          },
        },
      },
    },
  })

  if (!ts) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ts.employeeId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (ts.status !== 'draft') {
    return NextResponse.json({ error: 'Timesheet is not in draft status' }, { status: 422 })
  }
  if (!ts.employee.manager) {
    return NextResponse.json({ error: 'No manager assigned — cannot submit for approval' }, { status: 422 })
  }

  const managerId = ts.employee.manager.user.id

  const instance = await startInstance(
    'timesheet-approval',
    {
      timesheetId: ts.id,
      employeeId: ts.employeeId,
      managerId,
      weekStart: ts.weekStart.toISOString().split('T')[0],
      totalHours: Number(ts.totalHours),
    },
    `timesheet-${ts.id}`,
  )

  const updated = await db.timesheet.update({
    where: { id: ts.id },
    data: {
      status: 'submitted',
      workflowInstanceId: instance.id,
      submittedAt: new Date(),
    },
  })

  return NextResponse.json({ timesheet: updated })
}
