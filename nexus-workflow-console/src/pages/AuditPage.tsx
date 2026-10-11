import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
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
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type { AdminApi } from '../api/client'
import type { AuditPage as AuditPageData } from '../api/types'
import { isOperator, managedTenantIds, type Session } from '../auth/roles'
import { ACTION_FAMILIES, auditFacts, describeAudit } from '../auditText'
import { PageHeader } from '../components/PageHeader'
import { formatDate } from '../format'
import { ListFooter, ListToolbar } from '../list/ListControls'

const KIND_LABEL = { user: '', adminKey: 'admin key', apiKey: 'API key', anonymous: 'not signed in' } as const

/** A `datetime-local` value as an ISO date, or undefined if it is empty or not a date. */
const toIso = (local: string): string | undefined => {
  if (!local) return undefined
  const date = new Date(local)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** The value, but only after it has stopped changing for a moment (so typing does not ask for every letter). */
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function AuditPage({ api, session }: { api: AdminApi; session: Session }) {
  const operator = isOperator(session)
  const managed = useMemo(() => managedTenantIds(session).slice().sort(), [session])

  const [result, setResult] = useState<AuditPageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tenantOptions, setTenantOptions] = useState<string[]>(managed)
  const [tenant, setTenant] = useState('')
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const actorQuery = useDebounced(actor.trim())

  // Operators can pick any tenant; a manager only their own (the server refuses the rest anyway)
  useEffect(() => {
    if (!operator) return
    api
      .listTenants()
      .then((tenants) => setTenantOptions(tenants.map((t) => t.id)))
      .catch(() => undefined) // the filter then offers no tenants; the log itself shows real errors
  }, [api, operator])

  const latestRequest = useRef(0)
  const load = useCallback(async () => {
    const request = ++latestRequest.current
    try {
      const fromIso = toIso(from)
      const toIsoDate = toIso(to)
      const loaded = await api.listAudit({
        page,
        pageSize,
        ...(tenant ? { tenant } : {}),
        ...(actorQuery ? { actor: actorQuery } : {}),
        ...(action ? { action } : {}),
        ...(fromIso ? { from: fromIso } : {}),
        ...(toIsoDate ? { to: toIsoDate } : {}),
      })
      if (request !== latestRequest.current) return
      const lastPage = Math.max(0, Math.ceil(loaded.total / pageSize) - 1)
      if (page > lastPage) {
        setPage(lastPage)
        return
      }
      setResult(loaded)
      setError(null)
    } catch (err) {
      if (request !== latestRequest.current) return
      setError(err instanceof Error ? err.message : 'Could not load the audit log')
    }
  }, [api, page, pageSize, tenant, actorQuery, action, from, to])

  useEffect(() => {
    void load()
  }, [load])

  /** Changing a filter shows the first page of the new answer. */
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setPage(0)
  }
  const filtered = tenant !== '' || actorQuery !== '' || action !== '' || from !== '' || to !== ''

  return (
    <Box>
      <PageHeader
        title="Audit log"
        group="Administration"
        subtitle={operator ? 'Administrative actions and sign-ins, newest first' : `What happened in ${managed.length === 1 ? 'your tenant' : 'your tenants'}, newest first`}
      >
        <Tooltip title="Refresh">
          <IconButton aria-label="Refresh" onClick={() => void load()}>
            <RefreshRoundedIcon />
          </IconButton>
        </Tooltip>
      </PageHeader>

      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }}>
        <TextField select label="Tenant" value={tenant} onChange={(e) => filter(setTenant)(e.target.value)} sx={{ minWidth: 170 }}>
          <MenuItem value="">{operator ? 'All tenants' : 'All of mine'}</MenuItem>
          {tenantOptions.map((id) => (
            <MenuItem key={id} value={id}>
              {id}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="What" value={action} onChange={(e) => filter(setAction)(e.target.value)} sx={{ minWidth: 170 }}>
          <MenuItem value="">Everything</MenuItem>
          {ACTION_FAMILIES.filter((f) => operator || f.value !== 'login').map((f) => (
            <MenuItem key={f.value} value={f.value}>
              {f.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Who (user id)" value={actor} onChange={(e) => filter(setActor)(e.target.value)} sx={{ minWidth: 200 }} />
        <TextField label="From" type="datetime-local" value={from} onChange={(e) => filter(setFrom)(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField label="To" type="datetime-local" value={to} onChange={(e) => filter(setTo)(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      {result === null && !error ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading the audit log" />
        </Box>
      ) : (
        <>
          <ListToolbar pageSize={pageSize} onPageSize={filter(setPageSize)} />
          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Who</TableCell>
                  <TableCell>What happened</TableCell>
                  <TableCell>Tenants</TableCell>
                  <TableCell>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(result?.entries ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                      {filtered ? 'Nothing matches these filters' : 'Nothing has been recorded yet'}
                    </TableCell>
                  </TableRow>
                )}
                {(result?.entries ?? []).map((entry) => {
                  const kind = KIND_LABEL[entry.actor.kind]
                  const facts = auditFacts(entry)
                  return (
                    <TableRow key={entry.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(entry.at)}</TableCell>
                      <TableCell>
                        {entry.actor.label ?? <Typography component="span" color="text.secondary">unknown</Typography>}
                        {kind && <Chip size="small" variant="outlined" label={kind} sx={{ ml: 0.75 }} />}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{describeAudit(entry)}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {entry.action}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {entry.tenantIds.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            platform
                          </Typography>
                        ) : (
                          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                            {entry.tenantIds.map((id) => (
                              <Chip key={id} size="small" label={id} />
                            ))}
                          </Stack>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary" title={facts}>
                          {facts}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <ListFooter page={page} onPage={setPage} pageSize={pageSize} filteredCount={result?.total ?? 0} totalCount={result?.total ?? 0} />
          </TableContainer>
        </>
      )}
    </Box>
  )
}
