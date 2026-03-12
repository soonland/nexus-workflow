'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import { useSnackbar } from '@/components/SnackbarContext'

async function createTimesheet(weekStart: string) {
  return fetch('/api/timesheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekStart }),
  })
}

function NewTimesheetForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showSnackbar } = useSnackbar()
  const prefilledWeekStart = searchParams.get('weekStart') ?? ''

  const [weekStart, setWeekStart] = useState(prefilledWeekStart)
  const [loading, setLoading] = useState(false)

  // Auto-create when a weekStart is prefilled from the calendar
  useEffect(() => {
    if (!prefilledWeekStart) return
    setLoading(true)
    createTimesheet(prefilledWeekStart).then(async (res) => {
      if (res.ok) {
        const { timesheet } = await res.json()
        router.replace(`/timesheets/${timesheet.id}`)
      } else if (res.status === 409) {
        // Already exists — find it and redirect
        const listRes = await fetch(`/api/timesheets?from=${prefilledWeekStart}&to=${prefilledWeekStart}`)
        if (listRes.ok) {
          const timesheets = await listRes.json()
          if (timesheets[0]) {
            router.replace(`/timesheets/${timesheets[0].id}`)
            return
          }
        }
        showSnackbar({ message: 'A timesheet for this week already exists.', severity: 'error' })
        setLoading(false)
      } else {
        const data = await res.json()
        showSnackbar({ message: data.error ?? 'Failed to create timesheet', severity: 'error' })
        setLoading(false)
      }
    })
  }, [prefilledWeekStart]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!weekStart) return
    setLoading(true)
    const res = await createTimesheet(weekStart)
    if (res.ok) {
      const { timesheet } = await res.json()
      router.push(`/timesheets/${timesheet.id}`)
    } else {
      const data = await res.json()
      showSnackbar({ message: data.error ?? 'Failed to create timesheet', severity: 'error' })
      setLoading(false)
    }
  }

  if (prefilledWeekStart && loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 8, justifyContent: 'center' }}>
        <CircularProgress size={24} />
        <Typography color="text.secondary">Creating timesheet…</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 480 }}>
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
              <TextField
                id="weekStart"
                label="Week Start (Monday)"
                type="date"
                required
                value={weekStart}
                onChange={e => setWeekStart(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                helperText="Select the Monday that starts the week"
                fullWidth
              />
              <Stack direction="row" spacing={2}>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={loading || !weekStart}
                  startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
                  sx={{ flex: 1 }}
                >
                  {loading ? 'Creating…' : 'Create Timesheet'}
                </Button>
                <Button type="button" variant="outlined" onClick={() => router.back()}>
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

export default function NewTimesheetPage() {
  return (
    <Suspense fallback={
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 8, justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    }>
      <NewTimesheetForm />
    </Suspense>
  )
}
