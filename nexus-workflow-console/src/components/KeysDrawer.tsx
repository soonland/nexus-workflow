import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import type { AdminApi } from '../api/client'
import type { ApiKey, KeyRole, Tenant } from '../api/types'
import { formatDate } from '../format'
import { ConfirmDialog } from './ConfirmDialog'

const ROLE_HELP: Record<KeyRole, { label: string; help: string }> = {
  service: {
    label: 'Service',
    help: 'For programs: start and read instances, tasks, events, messages, and deploy or read definitions. Cannot cancel, suspend or restart instances, delete definitions, or use webhooks and metrics.',
  },
  tenant_manager: {
    label: 'Tenant manager',
    help: 'Everything in this tenant, including webhooks, metrics and the administrative commands. Use it for a trusted integration such as the ERP.',
  },
}

interface KeysDrawerProps {
  api: AdminApi
  tenant: Tenant | null
  onClose(): void
  /** Called after a key was created or revoked so the tenant list can refresh its key counts. */
  onChanged(): void
  /** Only a system admin may create a tenant_manager key or raise a key to it; operators can still lower one. */
  canGrantManagerKey?: boolean
}

export function KeysDrawer({ api, tenant, onClose, onChanged, canGrantManagerKey = true }: KeysDrawerProps) {
  // A role that cannot be handed out is not offered, except as the value a key already has
  const roleOptions = (current?: KeyRole) => (Object.keys(ROLE_HELP) as KeyRole[]).filter((role) => canGrantManagerKey || role !== 'tenant_manager' || role === current)
  const tenantId = tenant?.id ?? null
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<KeyRole>('service')
  // The key whose role is being edited, and the role chosen so far. One row at a time.
  const [editing, setEditing] = useState<{ keyId: string; role: KeyRole } | null>(null)
  const [saving, setSaving] = useState(false)
  // Save asks first: the key and the role waiting for a yes
  const [confirming, setConfirming] = useState<{ key: ApiKey; role: KeyRole } | null>(null)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    try {
      setKeys(await api.listKeys(tenantId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the keys')
    }
  }, [api, tenantId])

  useEffect(() => {
    setKeys(null)
    setError(null)
    setNewName('')
    setNewRole('service')
    setEditing(null)
    setConfirming(null)
    void load()
  }, [load])

  async function createKey() {
    if (!tenantId) return
    setCreating(true)
    setError(null)
    try {
      const result = await api.createKey(tenantId, newName.trim(), newRole)
      setCreated(result.plaintext)
      setCopied(false)
      setNewName('')
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the key')
    } finally {
      setCreating(false)
    }
  }

  async function revoke(key: ApiKey) {
    if (!tenantId) return
    setRevoking(null)
    try {
      await api.revokeKey(tenantId, key.id)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke the key')
    }
  }

  async function saveRole(key: ApiKey, role: KeyRole) {
    if (!tenantId) return
    setConfirming(null)
    setSaving(true)
    setError(null)
    try {
      await api.setKeyRole(tenantId, key.id, role)
      setEditing(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the key\'s role')
    } finally {
      setSaving(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const canCreate = tenant?.status === 'active'

  return (
    <>
      <Drawer anchor="right" open={tenant !== null} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 } } } }}>
        <Box sx={{ p: 3 }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box>
              <Typography variant="h6" component="h2">
                API keys
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tenant?.name} ({tenant?.id})
              </Typography>
            </Box>
            <IconButton aria-label="Close" onClick={onClose}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Stack
            direction="row"
            spacing={1}
            component="form"
            sx={{ mb: 3 }}
            onSubmit={(e) => {
              e.preventDefault()
              if (canCreate && newName.trim() !== '' && !creating) void createKey()
            }}
          >
            <TextField
              size="small"
              label="Key name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={!canCreate}
              helperText={canCreate ? 'For example "ci" or "nexus-erp"' : 'Only active tenants can get new keys'}
              fullWidth
              autoComplete="off"
            />
            <TextField
              select
              size="small"
              label="Role"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as KeyRole)}
              disabled={!canCreate}
              sx={{ minWidth: 170 }}
            >
              {roleOptions().map((role) => (
                <MenuItem key={role} value={role}>
                  {ROLE_HELP[role].label}
                </MenuItem>
              ))}
            </TextField>
            <Button type="submit" variant="contained" disabled={!canCreate || newName.trim() === '' || creating} sx={{ height: 40, whiteSpace: 'nowrap' }}>
              Create key
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -2, mb: 3 }}>
            {ROLE_HELP[newRole].help}
          </Typography>

          {keys === null && !error ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress size={28} aria-label="Loading keys" />
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Last used</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {(keys ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary' }}>
                      No keys yet
                    </TableCell>
                  </TableRow>
                )}
                {(keys ?? []).map((key) => (
                  <TableRow key={key.id} sx={key.revokedAt ? { opacity: 0.6 } : undefined}>
                    <TableCell>{key.name}</TableCell>
                    <TableCell>
                      {editing?.keyId === key.id ? (
                        <TextField
                            select
                            size="small"
                            value={editing.role}
                            onChange={(e) => setEditing({ keyId: key.id, role: e.target.value as KeyRole })}
                            disabled={saving}
                            slotProps={{ htmlInput: { 'aria-label': `Role of key ${key.name}` } }}
                            sx={{ minWidth: 150 }}
                          >
                            {roleOptions(key.role).map((role) => (
                              <MenuItem key={role} value={role}>
                                {ROLE_HELP[role].label}
                              </MenuItem>
                            ))}
                          </TextField>
                      ) : (
                        (ROLE_HELP[key.role]?.label ?? key.role)
                      )}
                    </TableCell>
                    <TableCell>{formatDate(key.createdAt)}</TableCell>
                    <TableCell>{formatDate(key.lastUsedAt)}</TableCell>
                    <TableCell align="right">
                      {key.revokedAt ? (
                        <Chip size="small" label="revoked" variant="outlined" />
                      ) : editing?.keyId === key.id ? (
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={saving || editing.role === key.role}
                            onClick={() => setConfirming({ key, role: editing.role })}
                            aria-label={`Save the role of key ${key.name}`}
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </Button>
                          <Button size="small" disabled={saving} onClick={() => setEditing(null)} aria-label={`Cancel editing key ${key.name}`}>
                            Cancel
                          </Button>
                        </Stack>
                      ) : (
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                          <Button size="small" onClick={() => setEditing({ keyId: key.id, role: key.role })} aria-label={`Edit key ${key.name}`}>
                            Edit
                          </Button>
                          <Button size="small" color="error" onClick={() => setRevoking(key)} aria-label={`Revoke key ${key.name}`}>
                            Revoke
                          </Button>
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Box>
      </Drawer>

      <Dialog open={created !== null} onClose={() => setCreated(null)} fullWidth maxWidth="sm">
        <DialogTitle>Copy your new API key</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This is the only time the key is shown. Only its hash is stored, so it cannot be recovered later.
          </DialogContentText>
          <Paper variant="outlined" sx={{ p: 1.5, fontFamily: 'monospace', wordBreak: 'break-all' }} data-testid="new-key">
            {created}
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button startIcon={<ContentCopyRoundedIcon />} onClick={() => created && void copy(created)}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="contained" onClick={() => setCreated(null)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.role === 'tenant_manager' ? 'Give this key more access?' : 'Give this key less access?'}
        confirmLabel={confirming?.role === 'tenant_manager' ? 'Raise to tenant manager' : 'Lower to service'}
        destructive={confirming?.role === 'service'}
        onConfirm={() => confirming && void saveRole(confirming.key, confirming.role)}
        onCancel={() => setConfirming(null)}
      >
        {confirming?.role === 'tenant_manager' ? (
          <>
            The key “{confirming.key.name}” will be able to do everything in this tenant, including webhooks and the administrative
            commands. Its secret does not change.
          </>
        ) : (
          <>
            The key “{confirming?.key.name}” will lose webhooks, metrics and the administrative commands (cancel, suspend, resume,
            restart, delete a definition) straight away: a program that uses them will get 403. Its secret does not change.
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this key?"
        confirmLabel="Revoke key"
        destructive
        onConfirm={() => revoking && void revoke(revoking)}
        onCancel={() => setRevoking(null)}
      >
        Anything using the key “{revoking?.name}” will immediately get 401 responses. This cannot be undone.
      </ConfirmDialog>
    </>
  )
}
