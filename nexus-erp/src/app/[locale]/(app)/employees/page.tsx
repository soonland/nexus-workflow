import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { getTranslations } from 'next-intl/server'
import { db } from '@/db/client'
import { auth } from '@/auth'
import EmployeesTable from '@/components/EmployeesTable'

const EmployeesPage = async () => {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const [employees, t] = await Promise.all([
    db.employee.findMany({
      include: {
        user: { select: { email: true, role: true } },
        department: { select: { name: true } },
      },
      orderBy: { fullName: 'asc' },
    }),
    getTranslations('employees'),
  ])

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2">{t('title')}</Typography>
      </Box>
      <EmployeesTable employees={employees} />
    </Box>
  )
}
export default EmployeesPage
