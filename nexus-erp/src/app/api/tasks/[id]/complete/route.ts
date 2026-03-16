import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { completeTask, getTask } from '@/lib/workflow'
import { db } from '@/db/client'
import { createAuditLog } from '@/lib/audit'

const completeSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'revision_requested']),
  rejectionReason: z.string().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = completeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { decision, rejectionReason } = parsed.data
  const completedById = session.user.id

  let taskData
  try {
    taskData = await getTask(id)
  } catch {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const instanceId = taskData.task.instanceId
  const variables = taskData.variables as Record<string, unknown>

  // Expense approval BPMN has no revision loop — only 'approved' or 'rejected' are valid.
  // 'revision_requested' would silently take the default (rejected) branch and permanently
  // terminate the instance, so reject it here before the engine advances.
  if (variables.expenseId && decision === 'revision_requested') {
    return NextResponse.json(
      { error: "Expense tasks do not support 'revision_requested' — use 'approved' or 'rejected'" },
      { status: 400 },
    )
  }

  const outputVariables: Record<string, unknown> = { decision }
  if (rejectionReason) outputVariables.rejectionReason = rejectionReason

  await completeTask(id, completedById, outputVariables)

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

      const updatedTs = await db.timesheet.update({
        where: { id: timesheet.id },
        data: {
          status: newStatus,
          ...(rejectionReason ? { rejectionReason } : {}),
          ...(newStatus !== 'pending_hr_review' ? { decidedAt: new Date() } : {}),
        },
      })

      await createAuditLog({
        db,
        entityType: 'Timesheet',
        entityId: timesheet.id,
        action: 'UPDATE',
        actorId: session.user.id,
        actorName: session.user.email ?? session.user.id,
        before: { status: timesheet.status },
        after: { status: updatedTs.status, ...(rejectionReason ? { rejectionReason } : {}) },
      })
    }
  }

  // Sync organization status
  if (variables.organizationId) {
    const org = await db.organization.findFirst({
      where: { workflowInstanceId: instanceId },
    })
    if (org) {
      const requestedStatus = variables.requestedStatus as 'active' | 'inactive' | undefined
      const updatedOrg = await db.organization.update({
        where: { id: org.id },
        data: decision === 'approved' && requestedStatus
          ? { status: requestedStatus, workflowInstanceId: null }
          : { workflowInstanceId: null, statusChangeReason: null },
      })

      await createAuditLog({
        db,
        entityType: 'Organization',
        entityId: org.id,
        action: 'UPDATE',
        actorId: session.user.id,
        actorName: session.user.email ?? session.user.id,
        before: { status: org.status },
        after: { status: updatedOrg.status },
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
          data: { status: 'APPROVED', resolvedById: completedById },
        })
      } else {
        await db.employeeProfileUpdateRequest.update({
          where: { id: request.id },
          data: {
            status: 'DENIED',
            resolvedById: completedById,
            rejectionReason: rejectionReason ?? null,
          },
        })
      }
    }
  }

  // Sync expense report status
  if (variables.expenseId) {
    const expense = await db.expenseReport.findFirst({
      where: { workflowInstanceId: instanceId },
    })
    if (expense) {
      const elementId = taskData.task.elementId

      let newStatus: 'APPROVED_MANAGER' | 'REIMBURSED' | 'REJECTED'
      if (elementId === 'task_manager_review') {
        newStatus = decision === 'approved' ? 'APPROVED_MANAGER' : 'REJECTED'
      } else {
        // task_accounting_review
        newStatus = decision === 'approved' ? 'REIMBURSED' : 'REJECTED'
      }

      const updatedExpense = await db.expenseReport.update({
        where: { id: expense.id },
        data: { status: newStatus },
      })

      await createAuditLog({
        db,
        entityType: 'ExpenseReport',
        entityId: expense.id,
        action: 'UPDATE',
        actorId: session.user.id,
        actorName: session.user.email ?? session.user.id,
        before: { status: expense.status },
        after: { status: updatedExpense.status, ...(rejectionReason ? { rejectionReason } : {}) },
      })
    }
  }

  return NextResponse.json({ success: true, decision })
}
