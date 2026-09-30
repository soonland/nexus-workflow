import { useState, type FormEvent } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material'
import type { AdminApi } from '../api/client'
import type { Tenant } from '../api/types'

/** Same rule the API enforces (it becomes part of a PostgreSQL schema name). */
export const TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

interface CreateTenantDialogProps {
  open: boolean
  api: AdminApi
  onCreated(tenant: Tenant): void
  onClose(): void
}

export function CreateTenantDialog({ open, api, onCreated, onClose }: CreateTenantDialogProps) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const idInvalid = id !== '' && !TENANT_ID_PATTERN.test(id)
  const canSubmit = id !== '' && !idInvalid && name.trim() !== '' && !busy

  function reset() {
    setId('')
    setName('')
    setError(null)
    setBusy(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const tenant = await api.createTenant(id, name.trim())
      reset()
      onCreated(tenant)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the tenant')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      fullWidth
      maxWidth="xs"
    >
      <form onSubmit={submit}>
        <DialogTitle>New tenant</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {error}
            </Alert>
          )}
          <TextField
            autoFocus
            fullWidth
            margin="normal"
            label="Tenant id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            error={idInvalid}
            helperText={
              idInvalid
                ? 'Only letters, digits, hyphens and underscores.'
                : 'Used in the schema name (tenant_<id>); cannot be changed later.'
            }
            autoComplete="off"
          />
          <TextField
            fullWidth
            margin="normal"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={!canSubmit}>
            Create tenant
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
