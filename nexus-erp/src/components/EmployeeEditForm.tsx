'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'

interface ManagerOption {
  id: string
  fullName: string
}

interface DepartmentOption {
  id: string
  name: string
}

interface EmployeeEditFormProps {
  employeeId: string
  defaultValues: {
    fullName: string
    departmentId: string | null
    hireDate: string
    managerId: string | null
    role: 'employee' | 'manager'
    phone: string | null
    street: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    country: string | null
  }
  managers: ManagerOption[]
  departments: DepartmentOption[]
}

export default function EmployeeEditForm({
  employeeId,
  defaultValues,
  managers,
  departments,
}: EmployeeEditFormProps) {
  const router = useRouter()
  const [form, setForm] = useState(defaultValues)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  function set(field: keyof typeof form, value: string | null) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (status !== 'idle') setStatus('idle')
  }

  async function handleSave() {
    setStatus('saving')
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setStatus('saved')
      router.refresh()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error')
      setStatus('error')
    }
  }

  return (
    <Stack spacing={3}>
      {status === 'saved' && <Alert severity="success">Changes saved.</Alert>}
      {status === 'error' && <Alert severity="error">{errorMsg}</Alert>}

      {/* Employment */}
      <Box>
        <Typography variant="overline" color="text.secondary">Employment</Typography>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Full Name"
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              fullWidth size="small"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Department"
              select
              value={form.departmentId ?? ''}
              onChange={(e) => set('departmentId', e.target.value || null)}
              fullWidth size="small"
            >
              <MenuItem value="">— None —</MenuItem>
              {departments.map((d) => (
                <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Hire Date"
              type="date"
              value={form.hireDate}
              onChange={(e) => set('hireDate', e.target.value)}
              fullWidth size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Manager"
              select
              value={form.managerId ?? ''}
              onChange={(e) => set('managerId', e.target.value || null)}
              fullWidth size="small"
            >
              <MenuItem value="">— None —</MenuItem>
              {managers.map((m) => (
                <MenuItem key={m.id} value={m.id}>{m.fullName}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Role"
              select
              value={form.role}
              onChange={(e) => set('role', e.target.value)}
              fullWidth size="small"
            >
              <MenuItem value="employee">Employee</MenuItem>
              <MenuItem value="manager">Manager</MenuItem>
            </TextField>
          </Grid>
        </Grid>
      </Box>

      <Divider />

      {/* Contact */}
      <Box>
        <Typography variant="overline" color="text.secondary">Contact</Typography>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Phone"
              value={form.phone ?? ''}
              onChange={(e) => set('phone', e.target.value || null)}
              fullWidth size="small"
              placeholder="+1 555 000 0000"
            />
          </Grid>
        </Grid>
      </Box>

      <Divider />

      {/* Address */}
      <Box>
        <Typography variant="overline" color="text.secondary">Address</Typography>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
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
      </Box>

      <Box>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={status === 'saving'}
        >
          {status === 'saving' ? 'Saving…' : 'Save Changes'}
        </Button>
      </Box>
    </Stack>
  )
}
