'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import CircularProgress from '@mui/material/CircularProgress'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'

export default function TaskDecisionForm({
  taskId,
  managerId,
}: {
  taskId: string
  managerId: string
}) {
  const router = useRouter()
  const [decision, setDecision] = useState<'approved' | 'rejected' | ''>('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!decision) return
    setLoading(true)
    setError('')
    const res = await fetch(`/api/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        managerId,
        decision,
        rejectionReason: decision === 'rejected' ? rejectionReason : undefined,
      }),
    })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to submit decision')
    } else {
      router.push('/tasks')
    }
  }

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={2.5}>
        <Typography variant="h6">Your Decision</Typography>

        {error && (
          <Alert severity="error">{error}</Alert>
        )}

        {/* Approve / Reject toggle buttons */}
        <Stack direction="row" spacing={2}>
          <Button
            type="button"
            variant={decision === 'approved' ? 'contained' : 'outlined'}
            color="success"
            startIcon={<CheckRoundedIcon />}
            onClick={() => setDecision('approved')}
            sx={{ flex: 1 }}
          >
            Approve
          </Button>
          <Button
            type="button"
            variant={decision === 'rejected' ? 'contained' : 'outlined'}
            color="error"
            startIcon={<CloseRoundedIcon />}
            onClick={() => setDecision('rejected')}
            sx={{ flex: 1 }}
          >
            Reject
          </Button>
        </Stack>

        {/* Rejection reason — only visible when rejected */}
        {decision === 'rejected' && (
          <TextField
            label="Rejection Reason (optional)"
            multiline
            rows={3}
            fullWidth
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
          />
        )}

        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={!decision || loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {loading ? 'Submitting…' : 'Submit Decision'}
        </Button>
      </Stack>
    </Box>
  )
}
