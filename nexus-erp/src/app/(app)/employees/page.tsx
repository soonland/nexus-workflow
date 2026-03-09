import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Avatar from '@mui/material/Avatar'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export default async function EmployeesPage() {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const employees = await db.employee.findMany({
    include: { user: { select: { email: true, role: true } } },
    orderBy: { fullName: 'asc' },
  })

  return (
    <Box>
      {/* Page header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2">Employees</Typography>
      </Box>

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Department</TableCell>
              <TableCell>Hire Date</TableCell>
              <TableCell>Role</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {employees.map((emp) => (
              <TableRow
                key={emp.id}
                sx={{ '&:hover': { backgroundColor: 'action.hover' } }}
              >
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Avatar sx={{ width: 32, height: 32, fontSize: '0.75rem', bgcolor: 'primary.light', color: 'primary.dark' }}>
                      {getInitials(emp.fullName)}
                    </Avatar>
                    <Typography variant="body2" fontWeight={500}>
                      {emp.fullName}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {emp.user.email}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {emp.department}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {emp.hireDate.toISOString().split('T')[0]}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={emp.user.role}
                    size="small"
                    color={emp.user.role === 'manager' ? 'primary' : 'default'}
                  />
                </TableCell>
                <TableCell align="right">
                  <Button
                    component={NextLink}
                    href={`/employees/${emp.id}`}
                    size="small"
                    variant="text"
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Box>
  )
}
