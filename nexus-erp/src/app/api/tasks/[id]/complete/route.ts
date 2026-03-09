import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { completeTask, getTask } from '@/lib/workflow'
import { db } from '@/db/client'

const completeSchema = z.object({
  managerId: z.string(),
  decision: z.enum(['approved', 'rejected']),
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

  // Get the task to find the instanceId
  let taskData
  try {
    taskData = await getTask(id)
  } catch {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  // Complete the workflow task
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
      await db.timesheet.update({
        where: { id: timesheet.id },
        data: { status: decision, decidedAt: new Date() },
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
