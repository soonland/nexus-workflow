import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TimesheetCalendar from './TimesheetCalendar'

export default async function TimesheetsPage() {
  const session = await auth()
  if (!session?.user.employeeId) redirect('/dashboard')

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2">My Timesheets</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Click any week to view details, or log hours on an empty week.
        </Typography>
      </Box>
      <TimesheetCalendar />
    </Box>
  )
}
