'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'

export default function NewTimesheetPage() {
  const router = useRouter()
  const [form, setForm] = useState({ weekStart: '', totalHours: '', notes: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function update(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/timesheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weekStart: form.weekStart,
        totalHours: parseFloat(form.totalHours),
        notes: form.notes || undefined,
      }),
    })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to create timesheet')
    } else {
      const { timesheet } = await res.json()
      router.push(`/timesheets/${timesheet.id}`)
    }
  }

  return (
    <Box sx={{ maxWidth: 560 }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton component={NextLink} href="/timesheets" size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3">New Timesheet</Typography>
      </Box>

      <Card>
        <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={3}>
              {error && (
                <Alert severity="error">{error}</Alert>
              )}

              <TextField
                id="weekStart"
                label="Week Start Date"
                type="date"
                required
                value={form.weekStart}
                onChange={update('weekStart')}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />

              <TextField
                id="totalHours"
                label="Total Hours"
                type="number"
                required
                value={form.totalHours}
                onChange={update('totalHours')}
                slotProps={{ htmlInput: { min: 0, max: 168, step: 0.5 } }}
                fullWidth
              />

              <TextField
                id="notes"
                label="Notes (optional)"
                multiline
                rows={3}
                value={form.notes}
                onChange={update('notes')}
                fullWidth
              />

              <Stack direction="row" spacing={2}>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
                  sx={{ flex: 1 }}
                >
                  {loading ? 'Creating…' : 'Create Timesheet'}
                </Button>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => router.back()}
                >
                  Cancel
                </Button>
              </Stack>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
