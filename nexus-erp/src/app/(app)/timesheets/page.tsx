import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'

const STATUS_COLOR: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  submitted: 'warning',
  approved: 'success',
  rejected: 'error',
}

export default async function TimesheetsPage() {
  const session = await auth()
  if (!session?.user.employeeId) redirect('/dashboard')

  const timesheets = await db.timesheet.findMany({
    where: { employeeId: session.user.employeeId },
    orderBy: { weekStart: 'desc' },
  })

  return (
    <Box>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">My Timesheets</Typography>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          component={NextLink}
          href="/timesheets/new"
        >
          New Timesheet
        </Button>
      </Box>

      <Card>
        {timesheets.length === 0 ? (
          <Box sx={{ py: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <ReceiptLongRoundedIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
            <Typography variant="body1" color="text.secondary">
              No timesheets yet. Create your first one!
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              component={NextLink}
              href="/timesheets/new"
            >
              New Timesheet
            </Button>
          </Box>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Week Start</TableCell>
                <TableCell>Hours</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {timesheets.map((ts) => (
                <TableRow
                  key={ts.id}
                  sx={{ '&:hover': { backgroundColor: 'action.hover' } }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {ts.weekStart.toISOString().split('T')[0]}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{ts.totalHours.toString()}h</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={ts.status}
                      size="small"
                      color={STATUS_COLOR[ts.status] ?? 'default'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {ts.notes ?? '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      component={NextLink}
                      href={`/timesheets/${ts.id}`}
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
        )}
      </Card>
    </Box>
  )
}
