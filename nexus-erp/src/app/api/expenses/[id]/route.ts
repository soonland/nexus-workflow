import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { createAuditLog } from '@/lib/audit'
import { canViewAllExpenses, canViewTeamExpenses } from '@/lib/expenseAccess'
import { startInstance } from '@/lib/workflow'

const lineItemSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => !isNaN(new Date(d).getTime()), { message: 'Invalid date' }),
  category: z.enum(['TRAVEL', 'MEALS', 'EQUIPMENT', 'OTHER']),
  amount: z.number().positive(),
  description: z.string().optional(),
})

const patchSchema = z.object({
  lineItems: z.array(lineItemSchema).min(1).optional(),
  status: z.literal('SUBMITTED').optional(),
}).refine((d) => d.lineItems !== undefined || d.status !== undefined, {
  message: 'At least one of lineItems or status must be provided',
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const report = await db.expenseReport.findUnique({
    where: { id },
    include: { lineItems: { orderBy: { date: 'asc' } } },
  })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const viewAll = await canViewAllExpenses(session, db)
  if (!viewAll) {
    const viewTeam = canViewTeamExpenses(session)
    if (viewTeam) {
      const reports = await db.employee.findMany({
        where: { managerId: session.user.employeeId },
        select: { id: true },
      })
      const ids = new Set([session.user.employeeId, ...reports.map((r) => r.id)])
      if (!ids.has(report.employeeId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (report.employeeId !== session.user.employeeId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const auditLogs = await db.auditLog.findMany({
    where: { entityType: 'ExpenseReport', entityId: id },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ ...report, auditLogs })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const report = await db.expenseReport.findUnique({ where: { id } })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (report.employeeId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  if (parsed.data.status === 'SUBMITTED' && !['DRAFT', 'REJECTED'].includes(report.status)) {
    return NextResponse.json({ error: 'Report must be in DRAFT or REJECTED status to submit' }, { status: 422 })
  }

  const EDITABLE_STATUSES = new Set(['DRAFT', 'REJECTED'])
  if (parsed.data.lineItems && !EDITABLE_STATUSES.has(report.status)) {
    return NextResponse.json({ error: 'Line items cannot be edited in this status' }, { status: 422 })
  }

  const actorId = session.user.id
  const actorName = session.user.email ?? session.user.id

  // When submitting, start the approval workflow
  let workflowInstanceId: string | undefined
  if (parsed.data.status === 'SUBMITTED') {
    const employee = await db.employee.findUnique({
      where: { id: report.employeeId },
      include: { manager: { include: { user: { select: { id: true } } } } },
    })
    if (!employee?.manager?.user) {
      return NextResponse.json({ error: 'No manager assigned — cannot submit for approval' }, { status: 422 })
    }
    const instance = await startInstance(
      'expense-approval',
      { expenseId: id, employeeId: report.employeeId, managerId: employee.manager.user.id },
      `expense-${id}-${Date.now()}`,
    )
    workflowInstanceId = instance.id
  }

  const updated = await db.$transaction(async (tx) => {
    if (parsed.data.lineItems) {
      await tx.expenseLineItem.deleteMany({ where: { reportId: id } })
      await tx.expenseLineItem.createMany({
        data: parsed.data.lineItems.map((item) => ({
          reportId: id,
          date: new Date(item.date),
          category: item.category,
          amount: item.amount,
          description: item.description,
        })),
      })
    }

    // When advancing to SUBMITTED, use updateMany with a status guard to prevent
    // double-submission races. A concurrent request that also passed the pre-transaction
    // status check will see count=0 and be turned away as a 409, keeping its
    // newly-started workflow instance from running to completion untracked.
    let result
    if (workflowInstanceId) {
      const { count } = await tx.expenseReport.updateMany({
        where: { id, status: { in: ['DRAFT', 'REJECTED'] } },
        data: { status: 'SUBMITTED', workflowInstanceId },
      })
      if (count === 0) return null // race lost — another request already advanced the status
      result = await tx.expenseReport.findUnique({
        where: { id },
        include: { lineItems: { orderBy: { date: 'asc' } } },
      })
    } else {
      result = await tx.expenseReport.update({
        where: { id },
        data: parsed.data.status ? { status: parsed.data.status } : {},
        include: { lineItems: { orderBy: { date: 'asc' } } },
      })
    }

    await createAuditLog({
      db: tx,
      entityType: 'ExpenseReport',
      entityId: id,
      action: 'UPDATE',
      actorId,
      actorName,
      before: { status: report.status },
      after: { status: result!.status, lineItemsReplaced: parsed.data.lineItems !== undefined, lineItemCount: result!.lineItems.length },
    })

    return result
  })

  if (updated === null) {
    return NextResponse.json({ error: 'Conflict — expense was already submitted' }, { status: 409 })
  }

  return NextResponse.json({ report: updated })
}
