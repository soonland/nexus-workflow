'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import CircularProgress from '@mui/material/CircularProgress'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'

interface InstanceActionsProps {
  instanceId: string
  status: string
}

const InstanceActions = ({ instanceId, status }: InstanceActionsProps) => {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  async function act(action: 'suspend' | 'resume' | 'cancel' | 'restart') {
    setLoading(action)
    try {
      await fetch(`/api/workflow/instances/${instanceId}/${action}`, { method: 'POST' })
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  const busy = loading !== null

  return (
    <Stack direction="row" spacing={1}>
      {status === 'active' && (
        <Button
          size="small"
          variant="outlined"
          color="warning"
          startIcon={loading === 'suspend' ? <CircularProgress size={14} /> : <PauseRoundedIcon />}
          disabled={busy}
          onClick={() => act('suspend')}
        >
          Suspend
        </Button>
      )}
      {status === 'suspended' && (
        <Button
          size="small"
          variant="outlined"
          color="success"
          startIcon={loading === 'resume' ? <CircularProgress size={14} /> : <PlayArrowRoundedIcon />}
          disabled={busy}
          onClick={() => act('resume')}
        >
          Resume
        </Button>
      )}
      {(status === 'active' || status === 'suspended') && (
        <Button
          size="small"
          variant="outlined"
          color="error"
          startIcon={loading === 'cancel' ? <CircularProgress size={14} /> : <CancelRoundedIcon />}
          disabled={busy}
          onClick={() => act('cancel')}
        >
          Cancel
        </Button>
      )}
      {status === 'terminated' && (
        <Button
          size="small"
          variant="outlined"
          color="primary"
          startIcon={loading === 'restart' ? <CircularProgress size={14} /> : <ReplayRoundedIcon />}
          disabled={busy}
          onClick={() => act('restart')}
        >
          Restart
        </Button>
      )}
    </Stack>
  )
}
export default InstanceActions
