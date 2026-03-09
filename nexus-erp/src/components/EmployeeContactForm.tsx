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
  const [form, setForm] = useState(defaultValues)
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

  if (pendingRequest) {
    return (
      <Alert severity="info">
        <Typography variant="body2" fontWeight={500}>Profile update pending HR review</Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Submitted on{' '}
          {new Date(pendingRequest.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric',
          })}
          . Your changes will be applied once approved.
        </Typography>
      </Alert>
    )
  }

  return (
    <Stack spacing={3}>
      {status === 'submitted' && (
        <Alert severity="success">
          Your update request has been submitted and is pending HR review.{' '}
          <Chip label="Pending" size="small" color="warning" sx={{ ml: 0.5 }} />
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
