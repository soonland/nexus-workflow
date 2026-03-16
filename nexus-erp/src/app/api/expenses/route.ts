import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ExpenseReportStatus } from '@prisma/client'
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

const createSchema = z.object({
  lineItems: z.array(lineItemSchema).min(1),
})

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const viewAll = await canViewAllExpenses(session, db)
  const viewTeam = canViewTeamExpenses(session)

  let employeeIdFilter: string | { in: string[] } | undefined

  if (viewAll) {
    // accounting: no filter — return all
    employeeIdFilter = undefined
  } else if (viewTeam) {
    // manager: own + direct reports
    const reports = await db.employee.findMany({
      where: { managerId: session.user.employeeId },
      select: { id: true },
    })
    const ids = [session.user.employeeId, ...reports.map((r) => r.id)]
    employeeIdFilter = { in: ids }
  } else {
    // employee: own only
    employeeIdFilter = session.user.employeeId
  }

  const { searchParams } = new URL(req.url)
  const rawStatus = searchParams.get('status')
  const status =
    rawStatus && Object.values(ExpenseReportStatus).includes(rawStatus as ExpenseReportStatus)
      ? (rawStatus as ExpenseReportStatus)
      : undefined

  const expenses = await db.expenseReport.findMany({
    where: {
      ...(employeeIdFilter !== undefined ? { employeeId: employeeIdFilter } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      lineItems: { orderBy: { date: 'asc' } },
      employee: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(expenses)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const report = await db.expenseReport.create({
    data: {
      employeeId: session.user.employeeId,
      lineItems: {
        create: parsed.data.lineItems.map((item) => ({
          date: new Date(item.date),
          category: item.category,
          amount: item.amount,
          description: item.description,
        })),
      },
    },
    include: { lineItems: true },
  })

  await createAuditLog({
    db,
    entityType: 'ExpenseReport',
    entityId: report.id,
    action: 'CREATE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    after: { id: report.id, employeeId: report.employeeId, status: report.status },
  })

  return NextResponse.json({ report }, { status: 201 })
}
