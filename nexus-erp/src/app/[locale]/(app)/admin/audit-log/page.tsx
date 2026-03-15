import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import AuditLogTable from '@/components/AuditLogTable'

const AuditLogPage = async () => {
  const session = await auth()
  if (!session) redirect('/login')
  if (session.user.role !== 'manager') redirect('/dashboard')

  const t = await getTranslations('auditLog')

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2">{t('title')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('description')}
        </Typography>
      </Box>
      <AuditLogTable />
    </Box>
  )
}

export default AuditLogPage
