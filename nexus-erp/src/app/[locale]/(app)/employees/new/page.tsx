import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { db } from '@/db/client'
import NewEmployeeForm from '@/components/NewEmployeeForm'

const NewEmployeePage = async () => {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const [departments, managers, t] = await Promise.all([
    db.department.findMany({ orderBy: { name: 'asc' } }),
    db.employee.findMany({
      where: { user: { role: 'manager' } },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true },
    }),
    getTranslations('employees'),
  ])

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2">{t('new.title')}</Typography>
      </Box>
      <NewEmployeeForm departments={departments} managers={managers} />
    </Box>
  )
}

export default NewEmployeePage
