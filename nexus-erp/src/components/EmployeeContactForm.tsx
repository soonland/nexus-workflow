'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'

interface ContactFormValues {
  phone: string | null
  street: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
}

interface PendingRequest {
  id: string
  createdAt: string
  phone: string | null
  street: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
}

interface EmployeeContactFormProps {
  employeeId: string
  defaultValues: ContactFormValues
  pendingRequest?: PendingRequest | null
}

export default function EmployeeContactForm({
  employeeId,
  defaultValues,
  pendingRequest,
}: EmployeeContactFormProps) {
  const router = useRouter()
  const [form, setForm] = useState<ContactFormValues>(
    pendingRequest
      ? { phone: pendingRequest.phone, street: pendingRequest.street, city: pendingRequest.city, state: pendingRequest.state, postalCode: pendingRequest.postalCode, country: pendingRequest.country }
      : defaultValues
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'submitted' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  function set(field: keyof ContactFormValues, value: string | null) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (status !== 'idle') setStatus('idle')
  }

  async function handleSubmit() {
    setStatus('saving')
    try {
      const res = await fetch(`/api/employees/${employeeId}/profile-update-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setStatus('submitted')
      router.refresh()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error')
      setStatus('error')
    }
  }

  return (
    <Stack spacing={3}>
      {pendingRequest && (
        <Alert severity="info" icon={false} sx={{ display: 'flex', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2">
              These changes are <strong>pending HR review</strong> since{' '}
              {new Date(pendingRequest.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
              You can still update them below.
            </Typography>
            <Chip label="In Review" size="small" color="warning" />
          </Box>
        </Alert>
      )}
      {status === 'submitted' && (
        <Alert severity="success">
          {pendingRequest ? 'Your pending request has been updated.' : 'Your update request has been submitted and is pending HR review.'}
        </Alert>
      )}
      {status === 'error' && <Alert severity="error">{errorMsg}</Alert>}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <TextField
            label="Phone"
            value={form.phone ?? ''}
            onChange={(e) => set('phone', e.target.value || null)}
            fullWidth size="small"
            placeholder="+1 555 000 0000"
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <TextField
            label="Street"
            value={form.street ?? ''}
            onChange={(e) => set('street', e.target.value || null)}
            fullWidth size="small"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="City"
            value={form.city ?? ''}
            onChange={(e) => set('city', e.target.value || null)}
            fullWidth size="small"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="State / Province"
            value={form.state ?? ''}
            onChange={(e) => set('state', e.target.value || null)}
            fullWidth size="small"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Postal Code"
            value={form.postalCode ?? ''}
            onChange={(e) => set('postalCode', e.target.value || null)}
            fullWidth size="small"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Country"
            value={form.country ?? ''}
            onChange={(e) => set('country', e.target.value || null)}
            fullWidth size="small"
          />
        </Grid>
      </Grid>

      <Box>
        <Button variant="contained" onClick={handleSubmit} disabled={status === 'saving'}>
          {status === 'saving' ? 'Submitting…' : 'Submit for Review'}
        </Button>
      </Box>
    </Stack>
  )
}
