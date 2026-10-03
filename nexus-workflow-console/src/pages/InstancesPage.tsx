import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Link,
  MenuItem,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type { TenantApi } from '../api/client'
import { INSTANCE_STATUSES, type InstanceStatus, type InstanceSummary, type Paged } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { InstanceStatusChip } from '../components/InstanceStatusChip'
import { PageHeader } from '../components/PageHeader'
import { formatDate } from '../format'

const PAGE_SIZE = 20

type Pending = { kind: 'cancel' | 'restart'; instance: InstanceSummary }

export function InstancesPage({ api, tenantId, onOpen }: { api: TenantApi; tenantId: string; onOpen(id: string): void }) {
  const [result, setResult] = useState<Paged<InstanceSummary> | null>(null)
  const [status, setStatus] = useState<InstanceStatus | ''>('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Pending | null>(null)

  // Answers can arrive out of order; only the newest request may update the screen
  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latestRequest.current
    try {
      const loaded = await api.listInstances({ ...(status ? { status } : {}), page, pageSize: PAGE_SIZE })
      if (request !== latestRequest.current) return
      // The last row of the last page may be gone (cancelled, filtered out): step back, which reloads
      const lastPage = Math.max(0, Math.ceil(loaded.total / PAGE_SIZE) - 1)
      if (page > lastPage) {
        setPage(lastPage)
        return
      }
      setResult(loaded)
      setError(null)
    } catch (err) {
      if (request !== latestRequest.current) return
      setError(err instanceof Error ? err.message : 'Could not load the instances')
    }
  }, [api, status, page])

  useEffect(() => {
    void load()
  }, [load])

  async function run(instance: InstanceSummary, action: () => Promise<unknown>, success: string) {
    setBusyId(instance.id)
    try {
      await action()
      setMessage({ severity: 'success', text: success })
    } catch (err) {
      setMessage({ severity: 'error', text: err instanceof Error ? err.message : 'The action failed' })
    } finally {
      setBusyId(null)
      await load()
    }
  }

  const short = (id: string) => id.slice(0, 8)

  return (
    <Box>
      <PageHeader title="Instances" group="Workflows" subtitle={`Running and finished workflows in ${tenantId}`}>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as InstanceStatus | '')
            setPage(0)
          }}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          {INSTANCE_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <Tooltip title="Refresh">
          <IconButton aria-label="Refresh" onClick={() => void load()}>
            <RefreshRoundedIcon />
          </IconButton>
        </Tooltip>
      </PageHeader>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      {result === null && !error ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading instances" />
        </Box>
      ) : (
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Instance</TableCell>
                <TableCell>Definition</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Started</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(result?.items ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No instances
                  </TableCell>
                </TableRow>
              )}
              {(result?.items ?? []).map((instance) => {
                const busy = busyId === instance.id
                const { id, status: state } = instance
                return (
                  <TableRow key={id} hover>
                    <TableCell>
                      <Link component="button" type="button" underline="hover" sx={{ fontFamily: 'monospace' }} title={id} onClick={() => onOpen(id)}>
                        {short(id)}
                      </Link>
                      {instance.businessKey && (
                        <Typography variant="caption" color="text.secondary">
                          {instance.businessKey}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {instance.definitionId} <Typography component="span" variant="caption" color="text.secondary">v{instance.definitionVersion}</Typography>
                    </TableCell>
                    <TableCell>
                      <InstanceStatusChip status={state} />
                    </TableCell>
                    <TableCell>{formatDate(instance.startedAt)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                        {state === 'active' && (
                          <Button size="small" disabled={busy} aria-label={`Suspend ${short(id)}`} onClick={() => void run(instance, () => api.suspendInstance(id), `Suspended ${short(id)}`)}>
                            Suspend
                          </Button>
                        )}
                        {state === 'suspended' && (
                          <Button size="small" disabled={busy} aria-label={`Resume ${short(id)}`} onClick={() => void run(instance, () => api.resumeInstance(id), `Resumed ${short(id)}`)}>
                            Resume
                          </Button>
                        )}
                        {(state === 'pending' || state === 'active' || state === 'suspended') && (
                          <Button size="small" color="error" disabled={busy} aria-label={`Cancel ${short(id)}`} onClick={() => setConfirming({ kind: 'cancel', instance })}>
                            Cancel
                          </Button>
                        )}
                        {state === 'terminated' && (
                          <Button size="small" disabled={busy} aria-label={`Restart ${short(id)}`} onClick={() => setConfirming({ kind: 'restart', instance })}>
                            Restart
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={result?.total ?? 0}
            page={page}
            rowsPerPage={PAGE_SIZE}
            rowsPerPageOptions={[PAGE_SIZE]}
            onPageChange={(_event, next) => setPage(next)}
          />
        </TableContainer>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.kind === 'restart' ? 'Restart this instance?' : 'Cancel this instance?'}
        confirmLabel={confirming?.kind === 'restart' ? 'Restart' : 'Cancel instance'}
        destructive={confirming?.kind === 'cancel'}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const pending = confirming
          setConfirming(null)
          if (!pending) return
          const { instance } = pending
          if (pending.kind === 'cancel') {
            void run(instance, () => api.cancelInstance(instance.id), `Cancelled ${short(instance.id)}`)
          } else {
            void run(
              instance,
              async () => {
                await api.restartInstance(instance.id)
              },
              `Restarted ${short(instance.id)} as a new instance`,
            )
          }
        }}
      >
        {confirming?.kind === 'restart' ? (
          <>
            This starts a <strong>new</strong> instance of {confirming.instance.definitionId} with the same variables as{' '}
            <strong>{short(confirming.instance.id)}</strong>. The terminated one stays as it is.
          </>
        ) : (
          <>
            This stops <strong>{confirming ? short(confirming.instance.id) : ''}</strong> for good and closes its open tasks. It cannot be
            resumed (it can be restarted as a new instance).
          </>
        )}
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
