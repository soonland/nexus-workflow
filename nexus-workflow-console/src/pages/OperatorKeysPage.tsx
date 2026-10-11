import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
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
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type { AdminApi } from '../api/client'
import type { OperatorKey } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageHeader } from '../components/PageHeader'
import { formatDate } from '../format'
import { ListFooter, ListToolbar, SortHeader } from '../list/ListControls'
import { useListView } from '../list/useListView'

type KeyState = 'active' | 'expired' | 'revoked'

const stateOf = (key: OperatorKey, now = Date.now()): KeyState =>
  key.revokedAt ? 'revoked' : key.expiresAt && new Date(key.expiresAt).getTime() <= now ? 'expired' : 'active'

// What the search looks in, and what each sortable column sorts by (module level: stable between renders)
const keyText = (k: OperatorKey) => `${k.name} ${stateOf(k)}`
const keySort = {
  name: (k: OperatorKey) => k.name,
  state: (k: OperatorKey) => stateOf(k),
  expires: (k: OperatorKey) => k.expiresAt,
  lastUsed: (k: OperatorKey) => k.lastUsedAt,
  created: (k: OperatorKey) => k.createdAt,
}

/** A `date` input value (a day) as the end of that day, in the person's own time zone. */
const endOfDay = (day: string): string | undefined => {
  if (!day) return undefined
  const date = new Date(`${day}T23:59:59`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function OperatorKeysPage({ api }: { api: AdminApi }) {
  const [keys, setKeys] = useState<OperatorKey[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [expires, setExpires] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<OperatorKey | null>(null)
  const view = useListView(keys, { searchText: keyText, sortValues: keySort })

  const latestRequest = useRef(0)
  const load = useCallback(async () => {
    const request = ++latestRequest.current
    try {
      const loaded = await api.listOperatorKeys()
      if (request !== latestRequest.current) return
      setKeys(loaded)
      setError(null)
    } catch (err) {
      if (request !== latestRequest.current) return
      setError(err instanceof Error ? err.message : 'Could not load the operator keys')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  function closeForm() {
    if (busy) return // a request is in flight: its answer must land in an open dialog
    setCreating(false)
    setName('')
    setExpires('')
    setFormError(null)
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    const expiresAt = endOfDay(expires)
    if (expires && !expiresAt) {
      setFormError('That is not a date.')
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const created = await api.createOperatorKey({ name: name.trim(), ...(expiresAt ? { expiresAt } : {}) })
      setBusy(false)
      setCreating(false)
      setName('')
      setExpires('')
      setSecret(created.plaintext)
      setCopied(false)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create the key')
      setBusy(false)
    }
  }

  async function revoke(key: OperatorKey) {
    setRevoking(null)
    try {
      await api.revokeOperatorKey(key.id)
      setMessage(`Revoked “${key.name}”`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke the key')
    }
    await load()
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Box>
      <PageHeader title="Operator keys" group="Platform" subtitle="Credentials for programs that administer the platform">
        <Tooltip title="Refresh">
          <IconButton aria-label="Refresh" onClick={() => void load()}>
            <RefreshRoundedIcon />
          </IconButton>
        </Tooltip>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setCreating(true)}>
          New operator key
        </Button>
      </PageHeader>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        An operator key does what an operator does (tenants, people, the audit log) and never opens a tenant&apos;s own data. It
        cannot create other keys. The secret is shown once, when the key is created.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      {keys === null && !error ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading operator keys" />
        </Box>
      ) : (
        <>
          <ListToolbar pageSize={view.pageSize} onPageSize={view.setPageSize} query={view.query} onQuery={view.setQuery} searchLabel="Search operator keys" />
          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <SortHeader label="Name" sortKey="name" sort={view.sort} onSort={view.toggleSort} />
                  <SortHeader label="State" sortKey="state" sort={view.sort} onSort={view.toggleSort} />
                  <SortHeader label="Expires" sortKey="expires" sort={view.sort} onSort={view.toggleSort} />
                  <SortHeader label="Last used" sortKey="lastUsed" sort={view.sort} onSort={view.toggleSort} />
                  <SortHeader label="Created" sortKey="created" sort={view.sort} onSort={view.toggleSort} />
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {view.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                      {view.query.trim() !== '' ? 'Nothing matches your search' : 'No operator keys yet'}
                    </TableCell>
                  </TableRow>
                )}
                {view.rows.map((key) => {
                  const state = stateOf(key)
                  return (
                    <TableRow key={key.id} hover sx={state === 'active' ? undefined : { opacity: 0.65 }}>
                      <TableCell sx={{ fontWeight: 600 }}>{key.name}</TableCell>
                      <TableCell>
                        <Chip size="small" label={state} color={state === 'active' ? 'success' : 'default'} variant={state === 'active' ? 'filled' : 'outlined'} />
                      </TableCell>
                      <TableCell>{key.expiresAt ? formatDate(key.expiresAt) : 'never'}</TableCell>
                      <TableCell>{formatDate(key.lastUsedAt)}</TableCell>
                      <TableCell>{formatDate(key.createdAt)}</TableCell>
                      <TableCell align="right">
                        {/* An expired key is already refused, so only a key that still works needs revoking */}
                        {state === 'active' && (
                          <Button size="small" color="error" onClick={() => setRevoking(key)} aria-label={`Revoke operator key ${key.name}`}>
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <ListFooter page={view.page} onPage={view.setPage} pageSize={view.pageSize} filteredCount={view.filteredCount} totalCount={view.totalCount} />
          </TableContainer>
        </>
      )}

      <Dialog open={creating} onClose={closeForm} fullWidth maxWidth="sm">
        <form onSubmit={create}>
          <DialogTitle>New operator key</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {formError && <Alert severity="error">{formError}</Alert>}
              <TextField
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                helperText="What it is for, e.g. “provisioning script”"
                slotProps={{ htmlInput: { maxLength: 255 } }}
              />
              <TextField
                label="Expires (optional)"
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                helperText="Last day it works. Leave empty for a key that does not expire."
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={closeForm}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={busy || name.trim() === ''}>
              {busy ? 'Creating…' : 'Create key'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={secret !== null} onClose={() => setSecret(null)} fullWidth maxWidth="sm">
        <DialogTitle>Copy your new operator key</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This is the only time the key is shown. Only its hash is stored, so it cannot be recovered later.
          </DialogContentText>
          <Paper variant="outlined" sx={{ p: 1.5, fontFamily: 'monospace', wordBreak: 'break-all' }} data-testid="new-operator-key">
            {secret}
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button startIcon={<ContentCopyRoundedIcon />} onClick={() => secret && void copy(secret)}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="contained" onClick={() => setSecret(null)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this operator key?"
        confirmLabel="Revoke key"
        destructive
        onConfirm={() => revoking && void revoke(revoking)}
        onCancel={() => setRevoking(null)}
      >
        Anything using the key “{revoking?.name}” is refused straight away. This cannot be undone.
      </ConfirmDialog>

      <Snackbar open={message !== null} autoHideDuration={5000} onClose={() => setMessage(null)} message={message ?? ''} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  )
}
