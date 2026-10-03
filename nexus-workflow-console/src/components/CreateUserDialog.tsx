import { useState, type FormEvent } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import type { AdminApi } from '../api/client'
import type { Invite, User } from '../api/types'
import { emptyChoice, RoleFields, toRequest } from './RoleFields'

interface Props {
  open: boolean
  api: AdminApi
  tenantIds: string[]
  canAssignOperator: boolean
  onClose(): void
  onCreated(user: User, invite: Invite): void
}

export function CreateUserDialog({ open, api, tenantIds, canAssignOperator, onClose, onCreated }: Props) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [choice, setChoice] = useState(() => emptyChoice(canAssignOperator))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function reset() {
    setEmail('')
    setName('')
    setChoice(emptyChoice(canAssignOperator))
    setError(null)
    setBusy(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const membership = toRequest(choice)
    if (!membership) {
      setError('Pick the tenant this person will manage.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { user, invite } = await api.createUser({ email: email.trim(), name: name.trim(), memberships: [membership] })
      reset()
      onCreated(user, invite)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the user')
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
      maxWidth="sm"
    >
      <form onSubmit={submit}>
        <DialogTitle>Invite a person</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <RoleFields value={choice} onChange={setChoice} tenantIds={tenantIds} canAssignOperator={canAssignOperator} />
          </Stack>
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
          <Button type="submit" variant="contained" disabled={busy || email.trim() === '' || name.trim() === ''}>
            {busy ? 'Creating…' : 'Create and get link'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
