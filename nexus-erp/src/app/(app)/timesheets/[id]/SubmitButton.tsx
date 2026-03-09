'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Box from '@mui/material/Box'

export default function SubmitButton({ timesheetId }: { timesheetId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setLoading(true)
    setError('')
    const res = await fetch(`/api/timesheets/${timesheetId}/submit`, { method: 'POST' })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to submit')
    } else {
      router.refresh()
    }
  }

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
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
