'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Box from '@mui/material/Box'
import { useSnackbar } from '@/components/SnackbarContext'

export default function SubmitButton({ timesheetId }: { timesheetId: string }) {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    setLoading(true)
    const res = await fetch(`/api/timesheets/${timesheetId}/submit`, { method: 'POST' })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json()
      showSnackbar({ message: data.error ?? 'Failed to submit', severity: 'error' })
    } else {
      router.refresh()
    }
  }

  return (
    <Box>
      <Button
        variant="contained"
        color="primary"
        fullWidth
        onClick={handleSubmit}
        disabled={loading}
        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
      >
        {loading ? 'Submitting…' : 'Submit for Approval'}
      </Button>
    </Box>
  )
}
