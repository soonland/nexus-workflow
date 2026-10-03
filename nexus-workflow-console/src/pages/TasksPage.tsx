import { useCallback, useEffect, useRef, useState } from 'react'
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
import { TASK_STATUSES, type Paged, type TaskStatus, type UserTask } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { formatDate } from '../format'
import { parseJsonObject } from '../jsonObject'

const PAGE_SIZE = 20

interface Props {
  api: TenantApi
  tenantId: string
  /** Who the actions are recorded as (claimed by, completed by). */
  actor: string
}

export function TasksPage({ api, tenantId, actor }: Props) {
  const [result, setResult] = useState<Paged<UserTask> | null>(null)
  const [status, setStatus] = useState<TaskStatus | ''>('open')
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [completing, setCompleting] = useState<UserTask | null>(null)
  const [variables, setVariables] = useState('')
  const [variablesError, setVariablesError] = useState<string | null>(null)

  // Answers can arrive out of order; only the newest request may update the screen
  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latestRequest.current
    try {
      const loaded = await api.listTasks({ ...(status ? { status } : {}), page, pageSize: PAGE_SIZE })
      if (request !== latestRequest.current) return
      const lastPage = Math.max(0, Math.ceil(loaded.total / PAGE_SIZE) - 1)
      if (page > lastPage) {
        setPage(lastPage)
        return
      }
      setResult(loaded)
      setError(null)
    } catch (err) {
      if (request !== latestRequest.current) return
      setError(err instanceof Error ? err.message : 'Could not load the tasks')
    }
  }, [api, status, page])

  useEffect(() => {
    void load()
  }, [load])

  async function run(task: UserTask, action: () => Promise<unknown>, success: string) {
    setBusyId(task.id)
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

  function closeCompleting() {
    setCompleting(null)
    setVariables('')
    setVariablesError(null)
  }

  function submitCompletion() {
    const task = completing
    if (!task) return
    const parsed = parseJsonObject(variables)
    if (!parsed.ok) {
      setVariablesError('The output variables must be a JSON object, for example {"approved": true}.')
      return
    }
    const output = parsed.value
    closeCompleting()
    void run(task, () => api.completeTask(task.id, actor, output), `Completed "${task.name}"`)
  }

  return (
    <Box>
      <PageHeader title="Tasks" group="Workflows" subtitle={`Human tasks in ${tenantId}`}>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as TaskStatus | '')
            setPage(0)
          }}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          {TASK_STATUSES.map((s) => (
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
          <CircularProgress aria-label="Loading tasks" />
        </Box>
      ) : (
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Task</TableCell>
                <TableCell>Assigned to</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Due</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(result?.items ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No tasks
                  </TableCell>
                </TableRow>
              )}
              {(result?.items ?? []).map((task) => {
                const busy = busyId === task.id
                const finished = task.status === 'completed' || task.status === 'cancelled'
                return (
                  <TableRow key={task.id} hover>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{task.name}</Typography>
                      <Typography variant="caption" color="text.secondary" title={task.instanceId}>
                        instance {task.instanceId.slice(0, 8)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {task.assignee ?? <Typography component="span" color="text.secondary">nobody</Typography>}
                      {task.candidateGroups?.map((group) => (
                        <Chip key={group} size="small" variant="outlined" label={group} sx={{ ml: 0.5 }} />
                      ))}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" variant={task.status === 'open' ? 'filled' : 'outlined'} label={task.status} />
                    </TableCell>
                    <TableCell>{task.dueDate ? formatDate(task.dueDate) : '—'}</TableCell>
                    <TableCell align="right">
                      {!finished && (
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                          {task.status === 'open' && (
                            <Button size="small" disabled={busy} aria-label={`Claim ${task.name}`} onClick={() => void run(task, () => api.claimTask(task.id, actor), `Claimed "${task.name}"`)}>
                              Claim
                            </Button>
                          )}
                          {task.status === 'claimed' && (
                            <Button size="small" disabled={busy} aria-label={`Release ${task.name}`} onClick={() => void run(task, () => api.releaseTask(task.id), `Released "${task.name}"`)}>
                              Release
                            </Button>
                          )}
                          <Button size="small" disabled={busy} aria-label={`Complete ${task.name}`} onClick={() => setCompleting(task)}>
                            Complete
                          </Button>
                        </Stack>
                      )}
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

      <Dialog open={completing !== null} onClose={closeCompleting} fullWidth maxWidth="sm">
        <DialogTitle>Complete this task?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            <strong>{completing?.name}</strong> is recorded as completed by {actor} and its workflow moves on. This cannot be undone.
          </DialogContentText>
          <TextField
            label="Output variables (JSON, optional)"
            value={variables}
            onChange={(e) => {
              setVariables(e.target.value)
              setVariablesError(null)
            }}
            error={variablesError !== null}
            helperText={variablesError ?? 'Handed to the workflow, e.g. {"approved": true}'}
            multiline
            minRows={3}
            fullWidth
            slotProps={{ htmlInput: { spellCheck: false } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCompleting}>Cancel</Button>
          <Button variant="contained" onClick={submitCompletion}>
            Complete task
          </Button>
        </DialogActions>
      </Dialog>

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
