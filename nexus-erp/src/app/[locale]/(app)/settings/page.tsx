import * as React from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Paper from '@mui/material/Paper'
import Divider from '@mui/material/Divider'
import { auth } from '@/auth'
import { getLocale } from 'next-intl/server'
import LanguageSelector from './LanguageSelector'

const SettingsPage = async () => {
  const [session, locale] = await Promise.all([auth(), getLocale()])

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography gutterBottom variant="h5">Settings</Typography>

      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography gutterBottom fontWeight={600} variant="subtitle1">
          Language
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
          Choose the language used throughout the interface.
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <LanguageSelector currentLocale={locale} userId={session!.user.id} />
      </Paper>
    </Box>
  )
}

export default SettingsPage
