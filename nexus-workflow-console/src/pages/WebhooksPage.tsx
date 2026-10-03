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
  DialogTitle,
  IconButton,
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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type { TenantApi } from '../api/client'
import type { Webhook } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageHeader } from '../components/PageHeader'
import { formatDate } from '../format'

export function WebhooksPage({ api, tenantId }: { api: TenantApi; tenantId: string }) {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Webhook | null>(null)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState('')
  const [secret, setSecret] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latestRequest.current
    try {
      const loaded = await api.listWebhooks()
      if (request !== latestRequest.current) return
      setWebhooks(loaded)
      setError(null)
    } catch (err) {
      if (request !== latestRequest.current) return
      setError(err instanceof Error ? err.message : 'Could not load the webhooks')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  function closeForm() {
    setCreating(false)
    setUrl('')
    setEvents('')
    setSecret('')
    setFormError(null)
    setBusy(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFormError(null)
    const names = events.split(',').map((name) => name.trim()).filter(Boolean)
    try {
      await api.createWebhook({ url: url.trim(), ...(names.length > 0 ? { events: names } : {}), ...(secret ? { secret } : {}) })
      closeForm()
      setMessage({ severity: 'success', text: 'Webhook added' })
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add the webhook')
      setBusy(false)
    }
  }

  async function remove(webhook: Webhook) {
    try {
      await api.deleteWebhook(webhook.id)
      setMessage({ severity: 'success', text: 'Webhook deleted' })
    } catch (err) {
      setMessage({ severity: 'error', text: err instanceof Error ? err.message : 'The delete failed' })
    }
    await load()
  }

  return (
    <Box>
      <PageHeader title="Webhooks" group="Workflows" subtitle={`Addresses called when workflow events happen in ${tenantId}`}>
        <Tooltip title="Refresh">
          <IconButton aria-label="Refresh" onClick={() => void load()}>
            <RefreshRoundedIcon />
          </IconButton>
        </Tooltip>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setCreating(true)}>
          Add webhook
        </Button>
      </PageHeader>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      {webhooks === null && !error ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading webhooks" />
        </Box>
      ) : (
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Address</TableCell>
                <TableCell>Events</TableCell>
                <TableCell>Added</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(webhooks ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No webhooks yet
                  </TableCell>
                </TableRow>
              )}
              {(webhooks ?? []).map((webhook) => (
                <TableRow key={webhook.id} hover>
                  <TableCell sx={{ wordBreak: 'break-all' }}>{webhook.url}</TableCell>
                  <TableCell>
                    {webhook.events.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        all events
                      </Typography>
                    ) : (
                      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        {webhook.events.map((name) => (
                          <Chip key={name} size="small" variant="outlined" label={name} />
                        ))}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(webhook.createdAt)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" color="error" onClick={() => setDeleting(webhook)} aria-label={`Delete webhook ${webhook.url}`}>
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={creating} onClose={closeForm} fullWidth maxWidth="sm">
        <form onSubmit={submit}>
          <DialogTitle>Add a webhook</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {formError && <Alert severity="error">{formError}</Alert>}
              <TextField label="Address (URL)" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required autoFocus />
              <TextField
                label="Events (optional)"
                value={events}
                onChange={(e) => setEvents(e.target.value)}
                helperText="Comma-separated event types, e.g. ProcessInstanceCompleted. Empty means all events."
              />
              <TextField
                label="Signing secret (optional)"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="off"
                helperText="Used to sign deliveries. It is not shown again after you save."
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeForm}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={busy || url.trim() === ''}>
              {busy ? 'Adding…' : 'Add webhook'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this webhook?"
        confirmLabel="Delete webhook"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const webhook = deleting
          setDeleting(null)
          if (webhook) void remove(webhook)
        }}
      >
        Events will no longer be sent to <strong>{deleting?.url}</strong>.
      </ConfirmDialog>

      <Snackbar
        open={message !== null}
        autoHideDuration={5000}
        onClose={() => setMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {message ? (
          <Alert severity={message.severity} onClose={() => setMessage(null)} variant="filled">
            {message.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  )
}
