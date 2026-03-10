'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import CircularProgress from '@mui/material/CircularProgress'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'

interface Props {
  definitionId: string
  disabled?: boolean
}

export default function DeleteDefinitionButton({ definitionId, disabled = false }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workflow/definitions/${definitionId}`, { method: 'DELETE' })
      if (res.status === 409) {
        setError('Cannot delete: this definition has pending, active, or suspended instances.')
        setLoading(false)
        return
      }
      if (!res.ok) {
        setError('Failed to delete definition.')
        setLoading(false)
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError('Network error.')
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        color="error"
        startIcon={<DeleteRoundedIcon />}
        disabled={disabled}
        onClick={() => { setError(null); setOpen(true) }}
      >
        Delete
      </Button>

      <Dialog open={open} onClose={() => !loading && setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete definition?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete <strong>{definitionId}</strong> (all versions).
            Instances that already ran are not affected.
          </DialogContentText>
          {error && (
            <DialogContentText color="error" sx={{ mt: 1 }}>
              {error}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <DeleteRoundedIcon />}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
