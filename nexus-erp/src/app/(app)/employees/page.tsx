import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import EmployeesTable from '@/components/EmployeesTable'

export default async function EmployeesPage() {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const employees = await db.employee.findMany({
    include: {
      user: { select: { email: true, role: true } },
      department: { select: { name: true } },
    },
    orderBy: { fullName: 'asc' },
  })

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2">Employees</Typography>
      </Box>
      <EmployeesTable employees={employees} />
    </Box>
  )
}
