import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { startInstance } from '@/lib/workflow'
import { createAuditLog } from '@/lib/audit'

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
      entries: { select: { hours: true } },
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
  if (ts.status !== 'draft' && ts.status !== 'revision_requested') {
    return NextResponse.json({ error: 'Timesheet cannot be submitted in its current status' }, { status: 422 })
  }
  if (!ts.employee.manager) {
    return NextResponse.json({ error: 'No manager assigned — cannot submit for approval' }, { status: 422 })
  }
  if (ts.entries.length === 0) {
    return NextResponse.json({ error: 'Cannot submit an empty timesheet — add at least one entry' }, { status: 422 })
  }

  const managerId = ts.employee.manager.user.id
  const totalHours = ts.entries.reduce((sum, e) => sum + Number(e.hours), 0)

  const instance = await startInstance(
    'timesheet-approval',
    {
      timesheetId: ts.id,
      employeeId: ts.employeeId,
      managerId,
      weekStart: ts.weekStart.toISOString().split('T')[0],
      totalHours,
    },
    `timesheet-${ts.id}-${Date.now()}`,
  )

  const updated = await db.timesheet.update({
    where: { id: ts.id },
    data: {
      status: 'pending_manager_review',
      workflowInstanceId: instance.id,
      submittedAt: new Date(),
      rejectionReason: null,
      decidedAt: null,
    },
  })

  await createAuditLog({
    db,
    entityType: 'Timesheet',
    entityId: ts.id,
    action: 'UPDATE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    before: { status: ts.status },
    after: { status: 'pending_manager_review', submittedAt: updated.submittedAt },
  })

  return NextResponse.json({ timesheet: updated })
}
