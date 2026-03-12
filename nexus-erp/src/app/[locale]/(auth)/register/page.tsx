'use client'

import { useState } from 'react'
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

const FIELD_TYPES: Record<string, string> = {
  email: 'email',
  password: 'password',
  fullName: 'text',
  department: 'text',
  hireDate: 'date',
}

type FormFields = 'email' | 'password' | 'fullName' | 'department' | 'hireDate'

const FIELDS: FormFields[] = ['email', 'password', 'fullName', 'department', 'hireDate']

const RegisterPage = () => {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const t = useTranslations('auth.register')
  const [form, setForm] = useState<Record<FormFields, string>>({
    email: '',
    password: '',
    fullName: '',
    department: '',
    hireDate: '',
  })
  const [loading, setLoading] = useState(false)

  function update(field: FormFields) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json()
      showSnackbar({ message: data.error ?? t('failed'), severity: 'error' })
    } else {
      router.push('/login')
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
        py: 4,
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
                {FIELDS.map((field) => (
                  <TextField
                    key={field}
                    id={field}
                    label={t(`fields.${field}`)}
                    type={FIELD_TYPES[field]}
                    required
                    fullWidth
                    value={form[field]}
                    onChange={update(field)}
                    slotProps={field === 'hireDate' ? { inputLabel: { shrink: true } } : undefined}
                    autoComplete={
                      field === 'email' ? 'email'
                      : field === 'password' ? 'new-password'
                      : field === 'fullName' ? 'name'
                      : undefined
                    }
                  />
                ))}

                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  size="large"
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {loading ? t('creating') : t('register')}
                </Button>
              </Stack>
            </Box>
          </CardContent>
        </Card>

        <Typography variant="body2" sx={{ textAlign: 'center', mt: 3, color: 'text.secondary' }}>
          {t('hasAccount')}{' '}
          <Link component={NextLink} href="/login" underline="hover" color="primary">
            {t('signIn')}
          </Link>
        </Typography>
      </Box>
    </Box>
  )
}
export default RegisterPage
