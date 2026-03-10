import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { completeTask, getTask } from '@/lib/workflow'
import { db } from '@/db/client'

const completeSchema = z.object({
  managerId: z.string(),
  decision: z.enum(['approved', 'rejected', 'revision_requested']),
  rejectionReason: z.string().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = completeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { managerId, decision, rejectionReason } = parsed.data

  let taskData
  try {
    taskData = await getTask(id)
  } catch {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const outputVariables: Record<string, unknown> = { decision }
  if (rejectionReason) outputVariables.rejectionReason = rejectionReason

  await completeTask(id, managerId, outputVariables)

  const instanceId = taskData.task.instanceId
  const variables = taskData.variables as Record<string, unknown>

  // Sync local timesheet status
  if (variables.timesheetId) {
    const timesheet = await db.timesheet.findFirst({
      where: { workflowInstanceId: instanceId },
    })
    if (timesheet) {
      const elementId = taskData.task.elementId

      let newStatus: 'pending_hr_review' | 'revision_requested' | 'rejected' | 'approved'
      if (elementId === 'task_manager_review') {
        if (decision === 'approved') newStatus = 'pending_hr_review'
        else if (decision === 'revision_requested') newStatus = 'revision_requested'
        else newStatus = 'rejected'
      } else {
        // task_hr_review
        if (decision === 'approved') newStatus = 'approved'
        else if (decision === 'revision_requested') newStatus = 'revision_requested'
        else newStatus = 'rejected'
      }

      await db.timesheet.update({
        where: { id: timesheet.id },
        data: {
          status: newStatus,
          ...(rejectionReason ? { rejectionReason } : {}),
          ...(newStatus !== 'pending_hr_review' ? { decidedAt: new Date() } : {}),
        },
      })
    }
  }

  // Sync profile update request status
  if (variables.updateRequestId) {
    const request = await db.employeeProfileUpdateRequest.findUnique({
      where: { id: variables.updateRequestId as string },
    })
    if (request && request.status === 'PENDING') {
      if (decision === 'approved') {
        await db.employee.update({
          where: { id: request.employeeId },
          data: {
            ...(request.phone !== null ? { phone: request.phone } : {}),
            ...(request.street !== null ? { street: request.street } : {}),
            ...(request.city !== null ? { city: request.city } : {}),
            ...(request.state !== null ? { state: request.state } : {}),
            ...(request.postalCode !== null ? { postalCode: request.postalCode } : {}),
            ...(request.country !== null ? { country: request.country } : {}),
          },
        })
        await db.employeeProfileUpdateRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', resolvedById: managerId },
        })
      } else {
        await db.employeeProfileUpdateRequest.update({
          where: { id: request.id },
          data: {
            status: 'DENIED',
            resolvedById: managerId,
            rejectionReason: rejectionReason ?? null,
          },
        })
      }
    }
  }

  return NextResponse.json({ success: true, decision })
}
