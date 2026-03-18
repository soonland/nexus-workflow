import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { getTranslations } from 'next-intl/server'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { canViewAllExpenses, canViewTeamExpenses } from '@/lib/expenseAccess'
import ExpensesTable from '@/components/ExpensesTable'

const ExpensesPage = async () => {
  const session = await auth()
  if (!session?.user.employeeId) redirect('/dashboard')

  const [viewAll, t] = await Promise.all([
    canViewAllExpenses(session, db),
    getTranslations('expenses'),
  ])

  const viewTeam = canViewTeamExpenses(session)

  let employeeIdFilter: string | { in: string[] } | undefined

  if (viewAll) {
    employeeIdFilter = undefined
  } else if (viewTeam) {
    const reports = await db.employee.findMany({
      where: { managerId: session.user.employeeId },
      select: { id: true },
    })
    const ids = [session.user.employeeId, ...reports.map((r) => r.id)]
    employeeIdFilter = { in: ids }
  } else {
    employeeIdFilter = session.user.employeeId
  }

  const expenses = await db.expenseReport.findMany({
    where: {
      ...(employeeIdFilter !== undefined ? { employeeId: employeeIdFilter } : {}),
    },
    include: {
      lineItems: { select: { amount: true }, orderBy: { date: 'asc' } },
      employee: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const serialized = expenses.map((exp) => ({
    ...exp,
    createdAt: exp.createdAt.toISOString(),
    updatedAt: exp.updatedAt.toISOString(),
    lineItems: exp.lineItems.map((item) => ({
      amount: Number(item.amount),
    })),
  }))

  const showEmployee = viewAll || viewTeam

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2">{t('title')}</Typography>
      </Box>
      <ExpensesTable expenses={serialized} showEmployee={showEmployee} />
    </Box>
  )
}
export default ExpensesPage
