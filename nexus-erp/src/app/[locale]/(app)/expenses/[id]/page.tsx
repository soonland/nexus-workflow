import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { canViewAllExpenses, canViewTeamExpenses } from '@/lib/expenseAccess'
import ExpenseDetailView from '@/components/ExpenseDetailView'

const ExpenseDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const session = await auth()
  if (!session?.user.employeeId) redirect('/dashboard')

  const { id } = await params

  const report = await db.expenseReport.findUnique({
    where: { id },
    include: { lineItems: { orderBy: { date: 'asc' } } },
  })
  if (!report) notFound()

  // Access control: own, team, or all
  const viewAll = await canViewAllExpenses(session, db)
  if (!viewAll) {
    const viewTeam = canViewTeamExpenses(session)
    if (viewTeam) {
      const teamMembers = await db.employee.findMany({
        where: { managerId: session.user.employeeId },
        select: { id: true },
      })
      const allowedIds = new Set([session.user.employeeId, ...teamMembers.map((m) => m.id)])
      if (!allowedIds.has(report.employeeId)) notFound()
    } else if (report.employeeId !== session.user.employeeId) {
      notFound()
    }
  }

  const auditLogs = await db.auditLog.findMany({
    where: { entityType: 'ExpenseReport', entityId: id },
    orderBy: { createdAt: 'asc' },
  })

  const t = await getTranslations('expenses.detail')

  const serialized = {
    id: report.id,
    status: report.status as string,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    employeeId: report.employeeId,
    lineItems: report.lineItems.map((item) => ({
      id: item.id,
      date: item.date.toISOString().slice(0, 10),
      category: item.category as string,
      amount: Number(item.amount),
      description: item.description ?? null,
    })),
    auditLogs: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      actorName: log.actorName,
      createdAt: log.createdAt.toISOString(),
      before: log.before as Record<string, unknown> | null,
      after: log.after as Record<string, unknown> | null,
    })),
  }

  const isOwner = report.employeeId === session.user.employeeId

  return (
    <ExpenseDetailView
      report={serialized}
      isOwner={isOwner}
      title={t('title')}
    />
  )
}

export default ExpenseDetailPage
