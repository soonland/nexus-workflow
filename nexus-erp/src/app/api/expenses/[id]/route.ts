import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { createAuditLog } from '@/lib/audit'
import { canViewAllExpenses, canViewTeamExpenses } from '@/lib/expenseAccess'

const lineItemSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(['TRAVEL', 'MEALS', 'EQUIPMENT', 'OTHER']),
  amount: z.number().positive(),
  description: z.string().optional(),
})

const patchSchema = z.object({
  lineItems: z.array(lineItemSchema).min(1).optional(),
  status: z.literal('SUBMITTED').optional(),
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

  if (parsed.data.status === 'SUBMITTED' && report.status !== 'REJECTED') {
    return NextResponse.json({ error: 'Only rejected reports can be resubmitted' }, { status: 422 })
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

    return tx.expenseReport.update({
      where: { id },
      data: parsed.data.status ? { status: parsed.data.status } : {},
      include: { lineItems: { orderBy: { date: 'asc' } } },
    })
  })

  await createAuditLog({
    db,
    entityType: 'ExpenseReport',
    entityId: id,
    action: 'UPDATE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    before: { status: report.status },
    after: { status: updated.status },
  })

  return NextResponse.json({ report: updated })
}
