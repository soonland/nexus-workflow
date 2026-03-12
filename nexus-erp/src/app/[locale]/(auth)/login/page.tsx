'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Stack from '@mui/material/Stack'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import { useTranslations } from 'next-intl'
import { useSnackbar } from '@/components/SnackbarContext'

const LoginPage = () => {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const t = useTranslations('auth.login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      showSnackbar({ message: t('invalidCredentials'), severity: 'error' })
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'background.default',
        px: 2,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 420 }}>
        {/* Logo / title */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h3" sx={{ fontWeight: 700, color: 'primary.main', mb: 0.5 }}>
            Nexus ERP
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </Box>

        <Card>
          <CardContent sx={{ p: 4, '&:last-child': { pb: 4 } }}>
            <Box component="form" onSubmit={handleSubmit}>
              <Stack spacing={3}>
                <TextField
                  id="email"
                  label={t('emailLabel')}
                  type="email"
                  required
                  fullWidth
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />

                <TextField
                  id="password"
                  label={t('passwordLabel')}
                  type="password"
                  required
                  fullWidth
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  size="large"
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {loading ? t('signingIn') : t('signIn')}
                </Button>
              </Stack>
            </Box>
          </CardContent>
        </Card>

        <Typography variant="body2" sx={{ textAlign: 'center', mt: 3, color: 'text.secondary' }}>
          {t('noAccount')}{' '}
          <Link component={NextLink} href="/register" underline="hover" color="primary">
            {t('register')}
          </Link>
        </Typography>
      </Box>
    </Box>
  )
}
export default LoginPage
