import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import TimesheetCalendar from './TimesheetCalendar'

const TimesheetsPage = async () => {
  const session = await auth()
  if (!session?.user.employeeId) redirect('/dashboard')

  const t = await getTranslations('timesheets')

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2" color="text.primary">{t('title')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('subtitle')}
        </Typography>
      </Box>
      <TimesheetCalendar />
    </Box>
  )
}
export default TimesheetsPage
