import * as React from 'react'
import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Paper from '@mui/material/Paper'
import Divider from '@mui/material/Divider'
import { getLocale } from 'next-intl/server'
import { auth } from '@/auth'
import LanguageSelector from './LanguageSelector'

const SettingsPage = async () => {
  const [session, locale] = await Promise.all([auth(), getLocale()])
  if (!session) redirect('/login')

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography gutterBottom variant="h5">Settings</Typography>

      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography gutterBottom variant="subtitle1" sx={{
          fontWeight: 600
        }}>
          Language
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            mb: 2
          }}>
          Choose the language used throughout the interface.
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <LanguageSelector currentLocale={locale} userId={session.user.id} />
      </Paper>
    </Box>
  )
}

export default SettingsPage
