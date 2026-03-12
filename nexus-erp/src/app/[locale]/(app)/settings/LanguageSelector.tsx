'use client'

import * as React from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CircularProgress from '@mui/material/CircularProgress'
import { useRouter, usePathname } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'

const LOCALES: { id: (typeof routing.locales)[number]; label: string; flag: string }[] = [
  { id: 'fr', label: 'Français', flag: '🇫🇷' },
  { id: 'en', label: 'English', flag: '🇬🇧' },
  { id: 'es', label: 'Español', flag: '🇪🇸' },
]

interface LanguageSelectorProps {
  userId: string
  currentLocale: string
}

const LanguageSelector = ({ userId, currentLocale }: LanguageSelectorProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, setPending] = React.useState(false)

  const handleChange = React.useCallback(
    async (newLocale: string) => {
      if (newLocale === currentLocale) return
      setPending(true)
      try {
        await fetch(`/api/users/${userId}/preferences`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: newLocale }),
        })
      } catch {
        // Non-critical — navigate anyway; cookie will be set by next-intl
      }
      router.push(pathname, { locale: newLocale as (typeof routing.locales)[number] })
    },
    [currentLocale, userId, router, pathname],
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Select
        aria-label="Select language"
        disabled={pending}
        size="small"
        sx={{ minWidth: 200 }}
        value={currentLocale}
        onChange={(e) => handleChange(e.target.value)}
      >
        {LOCALES.map((l) => (
          <MenuItem key={l.id} value={l.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
              <Typography component="span">{l.flag}</Typography>
              <Typography sx={{ flex: 1 }} variant="body2">{l.label}</Typography>
              {currentLocale === l.id && !pending && (
                <CheckRoundedIcon sx={{ fontSize: 14, color: 'primary.main' }} />
              )}
              {currentLocale === l.id && pending && (
                <CircularProgress size={12} />
              )}
            </Box>
          </MenuItem>
        ))}
      </Select>
    </Box>
  )
}

export default LanguageSelector
