'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import { useTranslations } from 'next-intl'
import SectionLabel from './SectionLabel'

// ── Types ────────────────────────────────────────────────────────────────────

interface ManagerOption {
  id: string
  fullName: string
}

interface DepartmentOption {
  id: string
  name: string
}

interface NewEmployeeFormProps {
  managers: ManagerOption[]
  departments: DepartmentOption[]
}

// ── Main component ────────────────────────────────────────────────────────────

const NewEmployeeForm = ({ managers, departments }: NewEmployeeFormProps) => {
  const router = useRouter()
  const t = useTranslations('employees.new')

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    hireDate: '',
    role: 'employee' as 'employee' | 'manager',
    departmentId: '',
    managerId: '',
    phone: '',
    street: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  })
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function setField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  function validate(): Partial<Record<string, string>> {
    const errs: Partial<Record<string, string>> = {}
    if (!form.fullName.trim()) errs.fullName = t('validation.fullNameRequired')
    if (!form.email.trim()) {
      errs.email = t('validation.emailRequired')
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = t('validation.emailInvalid')
    }
    if (!form.password) {
      errs.password = t('validation.passwordRequired')
    } else if (form.password.length < 8) {
      errs.password = t('validation.passwordMinLength')
    }
    if (!form.hireDate) errs.hireDate = t('validation.hireDateRequired')
    return errs
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          password: form.password,
          hireDate: form.hireDate,
          role: form.role,
          ...(form.departmentId ? { departmentId: form.departmentId } : {}),
          ...(form.managerId ? { managerId: form.managerId } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
          ...(form.street ? { street: form.street } : {}),
          ...(form.city ? { city: form.city } : {}),
          ...(form.state ? { state: form.state } : {}),
          ...(form.postalCode ? { postalCode: form.postalCode } : {}),
          ...(form.country ? { country: form.country } : {}),
        }),
      })

      if (res.status === 409) {
        setFieldErrors({ email: t('validation.emailInUse') })
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Error ${res.status}`)
      }

      const data = (await res.json()) as { employee: { id: string } }
      router.push(`/employees/${data.employee.id}`)
    } catch (e) {
      setServerError(e instanceof Error ? e.message : t('createFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      {serverError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {serverError}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {/* ── Employment section ── */}
        <Box sx={{ p: 3 }}>
          <SectionLabel>{t('sections.employment')}</SectionLabel>
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label={t('fields.fullName')}
                value={form.fullName}
                onChange={(e) => setField('fullName', e.target.value)}
                required
                fullWidth
                size="small"
                error={!!fieldErrors.fullName}
                helperText={fieldErrors.fullName}
                inputProps={{ 'aria-required': true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.email')}
                type="email"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                required
                fullWidth
                size="small"
                error={!!fieldErrors.email}
                helperText={fieldErrors.email}
                inputProps={{ 'aria-required': true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.password')}
                type="password"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                required
                fullWidth
                size="small"
                error={!!fieldErrors.password}
                helperText={fieldErrors.password}
                inputProps={{ 'aria-required': true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.hireDate')}
                type="date"
                value={form.hireDate}
                onChange={(e) => setField('hireDate', e.target.value)}
                required
                fullWidth
                size="small"
                error={!!fieldErrors.hireDate}
                helperText={fieldErrors.hireDate}
                slotProps={{ inputLabel: { shrink: true } }}
                inputProps={{ 'aria-required': true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.role')}
                select
                value={form.role}
                onChange={(e) => setField('role', e.target.value)}
                fullWidth
                size="small"
              >
                <MenuItem value="employee">{t('roles.employee')}</MenuItem>
                <MenuItem value="manager">{t('roles.manager')}</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.department')}
                select
                value={form.departmentId}
                onChange={(e) => setField('departmentId', e.target.value)}
                fullWidth
                size="small"
              >
                <MenuItem value="">{t('placeholders.noDepartment')}</MenuItem>
                {departments.map((d) => (
                  <MenuItem key={d.id} value={d.id}>
                    {d.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.manager')}
                select
                value={form.managerId}
                onChange={(e) => setField('managerId', e.target.value)}
                fullWidth
                size="small"
              >
                <MenuItem value="">{t('placeholders.noManager')}</MenuItem>
                {managers.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.fullName}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
        </Box>

        <Divider />

        {/* ── Contact & Address section ── */}
        <Box sx={{ p: 3 }}>
          <SectionLabel>{t('sections.contactAddress')}</SectionLabel>
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.phone')}
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                fullWidth
                size="small"
                placeholder="+1 555 000 0000"
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label={t('fields.street')}
                value={form.street}
                onChange={(e) => setField('street', e.target.value)}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.city')}
                value={form.city}
                onChange={(e) => setField('city', e.target.value)}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.state')}
                value={form.state}
                onChange={(e) => setField('state', e.target.value)}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.postalCode')}
                value={form.postalCode}
                onChange={(e) => setField('postalCode', e.target.value)}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.country')}
                value={form.country}
                onChange={(e) => setField('country', e.target.value)}
                fullWidth
                size="small"
              />
            </Grid>
          </Grid>
        </Box>

        {/* ── Footer ── */}
        <Box
          sx={{
            px: 3,
            py: 2,
            borderTop: 1,
            borderColor: 'divider',
            backgroundColor: 'background.paper',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? t('submitting') : t('submit')}
          </Button>
          <Button href="/employees" disabled={submitting}>
            {t('cancel')}
          </Button>
        </Box>
      </Paper>
    </Box>
  )
}

export default NewEmployeeForm
