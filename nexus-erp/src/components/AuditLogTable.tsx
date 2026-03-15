'use client'

import * as React from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import OutlinedInput from '@mui/material/OutlinedInput'
import Select, { type SelectChangeEvent } from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslations } from 'next-intl'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string
  entityType: string
  entityId: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  actorId: string
  actorName: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  createdAt: string
}

interface AuditLogResponse {
  entries: AuditEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface Filters {
  entityTypes: string[]
  actions: string[]
  actorName: string
  from: string
  to: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ENTITY_TYPES = ['Employee', 'Timesheet', 'Organization', 'Department', 'Group']
const ACTION_TYPES = ['CREATE', 'UPDATE', 'DELETE'] as const

const ACTION_COLORS: Record<string, 'success' | 'warning' | 'error'> = {
  CREATE: 'success',
  UPDATE: 'warning',
  DELETE: 'error',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function summariseDiff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before && after) return Object.keys(after).join(', ')
  if (before && !after) return Object.keys(before).join(', ')
  if (!before || !after) return '—'

  const changed = Object.keys({ ...before, ...after }).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  )
  return changed.length > 0 ? changed.join(', ') : '—'
}

function buildParams(filters: Filters, page: number): string {
  const params = new URLSearchParams()
  filters.entityTypes.forEach((t) => params.append('entityType', t))
  filters.actions.forEach((a) => params.append('action', a))
  if (filters.actorName) params.set('actorId', filters.actorName)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  params.set('page', String(page))
  return params.toString()
}

// ── Component ──────────────────────────────────────────────────────────────────

const AuditLogTable = () => {
  const t = useTranslations('auditLog')

  const [filters, setFilters] = React.useState<Filters>({
    entityTypes: [],
    actions: [],
    actorName: '',
    from: '',
    to: '',
  })
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<AuditLogResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')

  const fetchData = React.useCallback(async (f: Filters, p: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/audit-log?${buildParams(f, p)}`)
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setError(body.error ?? 'Failed to load')
        return
      }
      const json = await res.json() as AuditLogResponse
      setData(json)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void fetchData(filters, page)
  }, [fetchData, filters, page])

  const handleEntityTypesChange = (event: SelectChangeEvent<string[]>) => {
    const val = event.target.value
    setFilters((f) => ({ ...f, entityTypes: typeof val === 'string' ? val.split(',') : val }))
    setPage(1)
  }

  const handleActionsChange = (event: SelectChangeEvent<string[]>) => {
    const val = event.target.value
    setFilters((f) => ({ ...f, actions: typeof val === 'string' ? val.split(',') : val }))
    setPage(1)
  }

  const handleClear = () => {
    setFilters({ entityTypes: [], actions: [], actorName: '', from: '', to: '' })
    setPage(1)
  }

  return (
    <Stack spacing={2}>
      {/* Filter bar */}
      <Card sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          {/* Entity type multi-select */}
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('filters.entityType')}</InputLabel>
            <Select
              multiple
              value={filters.entityTypes}
              onChange={handleEntityTypesChange}
              input={<OutlinedInput label={t('filters.entityType')} />}
              renderValue={(selected) => selected.join(', ')}
            >
              {ENTITY_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Action multi-select */}
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{t('filters.action')}</InputLabel>
            <Select
              multiple
              value={filters.actions}
              onChange={handleActionsChange}
              input={<OutlinedInput label={t('filters.action')} />}
              renderValue={(selected) => selected.join(', ')}
            >
              {ACTION_TYPES.map((action) => (
                <MenuItem key={action} value={action}>
                  {t(`actions.${action}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Actor name / email filter */}
          <TextField
            size="small"
            label={t('filters.actor')}
            value={filters.actorName}
            onChange={(e) => { setFilters((f) => ({ ...f, actorName: e.target.value })); setPage(1) }}
            sx={{ minWidth: 200 }}
          />

          {/* Date range */}
          <TextField
            size="small"
            label={t('filters.from')}
            type="date"
            value={filters.from}
            onChange={(e) => { setFilters((f) => ({ ...f, from: e.target.value })); setPage(1) }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            label={t('filters.to')}
            type="date"
            value={filters.to}
            onChange={(e) => { setFilters((f) => ({ ...f, to: e.target.value })); setPage(1) }}
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <Button size="small" variant="text" color="inherit" onClick={handleClear}>
            {t('filters.clearFilters')}
          </Button>
        </Stack>
      </Card>

      {/* Table */}
      <Card>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Box sx={{ p: 3 }}>
            <Typography color="error">{error}</Typography>
          </Box>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('columns.timestamp')}</TableCell>
                  <TableCell>{t('columns.actor')}</TableCell>
                  <TableCell>{t('columns.entityType')}</TableCell>
                  <TableCell>{t('columns.entityId')}</TableCell>
                  <TableCell>{t('columns.action')}</TableCell>
                  <TableCell>{t('columns.changes')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                        {t('emptyState')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.entries.map((entry) => (
                    <TableRow key={entry.id} sx={{ '&:hover': { backgroundColor: 'action.hover' } }}>
                      <TableCell>
                        <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
                          {formatDateTime(entry.createdAt)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{entry.actorName}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{entry.entityType}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}>
                          {entry.entityId.slice(0, 8)}…
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={t(`actions.${entry.action}`)}
                          size="small"
                          color={ACTION_COLORS[entry.action] ?? 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {summariseDiff(entry.before, entry.after)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {/* Pagination */}
            {data && data.totalPages > 1 && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('pagination.page', { page: data.page, total: data.totalPages })}
                </Typography>
                <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  {t('pagination.previous')}
                </Button>
                <Button size="small" variant="outlined" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                  {t('pagination.next')}
                </Button>
              </Box>
            )}
          </>
        )}
      </Card>
    </Stack>
  )
}

export default AuditLogTable
