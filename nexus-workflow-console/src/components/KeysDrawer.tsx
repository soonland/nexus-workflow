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
}

export function KeysDrawer({ api, tenant, onClose, onChanged }: KeysDrawerProps) {
  const tenantId = tenant?.id ?? null
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<KeyRole>('service')
  const [changing, setChanging] = useState<{ key: ApiKey; role: KeyRole } | null>(null)
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

  async function changeRole(key: ApiKey, role: KeyRole) {
    if (!tenantId) return
    setChanging(null)
    try {
      await api.setKeyRole(tenantId, key.id, role)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the key\'s role')
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
              {(Object.keys(ROLE_HELP) as KeyRole[]).map((role) => (
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
                      {key.revokedAt ? (
                        ROLE_HELP[key.role]?.label ?? key.role
                      ) : (
                        <TextField
                          select
                          size="small"
                          value={key.role}
                          onChange={(e) => setChanging({ key, role: e.target.value as KeyRole })}
                          slotProps={{ htmlInput: { 'aria-label': `Role of key ${key.name}` } }}
                          sx={{ minWidth: 150 }}
                        >
                          {(Object.keys(ROLE_HELP) as KeyRole[]).map((role) => (
                            <MenuItem key={role} value={role}>
                              {ROLE_HELP[role].label}
                            </MenuItem>
                          ))}
                        </TextField>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(key.createdAt)}</TableCell>
                    <TableCell>{formatDate(key.lastUsedAt)}</TableCell>
                    <TableCell align="right">
                      {key.revokedAt ? (
                        <Chip size="small" label="revoked" variant="outlined" />
                      ) : (
                        <Button size="small" color="error" onClick={() => setRevoking(key)} aria-label={`Revoke key ${key.name}`}>
                          Revoke
                        </Button>
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
        open={changing !== null}
        title={changing?.role === 'tenant_manager' ? 'Give this key more access?' : 'Give this key less access?'}
        confirmLabel={changing?.role === 'tenant_manager' ? 'Raise to tenant manager' : 'Lower to service'}
        destructive={changing?.role === 'service'}
        onConfirm={() => changing && void changeRole(changing.key, changing.role)}
        onCancel={() => setChanging(null)}
      >
        {changing?.role === 'tenant_manager' ? (
          <>
            The key “{changing.key.name}” will be able to do everything in this tenant, including webhooks and the administrative
            commands. Its secret does not change.
          </>
        ) : (
          <>
            The key “{changing?.key.name}” will lose webhooks, metrics and the administrative commands (cancel, suspend, resume,
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
