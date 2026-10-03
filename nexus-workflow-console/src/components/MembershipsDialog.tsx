import { useState } from 'react'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material'
import type { AdminApi } from '../api/client'
import type { Membership, UserWithMemberships } from '../api/types'
import { emptyChoice, RoleFields, toRequest } from './RoleFields'

interface Props {
  user: UserWithMemberships | null
  api: AdminApi
  tenantIds: string[]
  canAssignOperator: boolean
  /** Whether the signed-in person may remove this particular membership. */
  canRemove(membership: Membership): boolean
  onClose(): void
  /** Something changed: reload the list. */
  onChanged(): void
}

const describe = (m: Membership) => (m.role === 'operator' ? 'Operator' : `Tenant manager of ${m.tenantId}`)

export function MembershipsDialog({ user, api, tenantIds, canAssignOperator, canRemove, onClose, onChanged }: Props) {
  const [choice, setChoice] = useState(() => emptyChoice(canAssignOperator))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function act(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change failed')
    } finally {
      setBusy(false)
    }
  }

  const request = toRequest(choice)

  return (
    <Dialog open={user !== null} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Roles of {user?.name}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <List dense disablePadding>
          {user?.memberships.length === 0 && (
            <ListItem disableGutters>
              <ListItemText secondary="No roles yet" />
            </ListItem>
          )}
          {user?.memberships.map((m) => (
            <ListItem
              key={m.id}
              disableGutters
              secondaryAction={
                canRemove(m) ? (
                  <Button size="small" color="error" disabled={busy} aria-label={`Remove ${describe(m)}`} onClick={() => void act(() => api.removeMembership(user.id, m.id))}>
                    Remove
                  </Button>
                ) : (
                  <Chip size="small" label="out of your scope" />
                )
              }
            >
              <ListItemText primary={describe(m)} />
            </ListItem>
          ))}
        </List>
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" gutterBottom>
          Add a role
        </Typography>
        <RoleFields value={choice} onChange={setChoice} tenantIds={tenantIds} canAssignOperator={canAssignOperator} />
      </DialogContent>
      <DialogActions>
        <Button
          disabled={busy || !request}
          onClick={() => {
            if (user && request) void act(() => api.addMembership(user.id, request))
          }}
        >
          Add role
        </Button>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}
