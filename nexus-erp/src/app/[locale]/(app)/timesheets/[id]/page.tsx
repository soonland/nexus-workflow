'use client'

import React, { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NextLink from 'next/link'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableFooter from '@mui/material/TableFooter'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import MailRoundedIcon from '@mui/icons-material/MailRounded'
import { useTranslations } from 'next-intl'
import { useSnackbar } from '@/components/SnackbarContext'
import AuditLogPanel from '@/components/AuditLogPanel'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimesheetEntry {
  id: string
  date: string
  hours: string
  projectCode: string | null
  description: string | null
}

interface Timesheet {
  id: string
  weekStart: string
  status: string
  employeeId: string
  rejectionReason: string | null
  submittedAt: string | null
  decidedAt: string | null
  entries: TimesheetEntry[]
}

/**
 * A project row in the grid. `cells` maps ISO date string → entry data.
 * null means no entry exists for that day yet.
 */
interface ProjectRow {
  rowKey: string // stable key: projectCode|description (or a UUID for new rows)
  projectCode: string
  description: string
  cells: Record<string, { entryId: string; hours: number } | null>
}

// ---------------------------------------------------------------------------
// Date utility functions
// ---------------------------------------------------------------------------

function parseUtcDate(isoString: string): Date {
  const d = new Date(isoString)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function getWeekDays(weekStartIso: string): Date[] {
  const start = parseUtcDate(weekStartIso)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

function buildWeekRangeParts(weekStartIso: string): { startStr: string; endDay: number; year: number } {
  const days = getWeekDays(weekStartIso)
  const start = days[0]
  const end = days[6]
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endDay = end.getDate()
  const year = end.getFullYear()
  return { startStr, endDay, year }
}

function dateToIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDayAbbrev(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

function formatDayNum(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isToday(date: Date): boolean {
  const today = new Date()
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6 // Sunday or Saturday
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

type StatusColor = 'default' | 'warning' | 'info' | 'secondary' | 'success' | 'error'

const STATUS_COLOR: Record<string, StatusColor> = {
  draft: 'default',
  submitted: 'warning',
  pending_manager_review: 'info',
  pending_hr_review: 'secondary',
  revision_requested: 'warning',
  approved: 'success',
  rejected: 'error',
}

// ---------------------------------------------------------------------------
// Data transform: flat entries[] → ProjectRow[]
// ---------------------------------------------------------------------------

function buildProjectRows(entries: TimesheetEntry[], weekDays: Date[]): ProjectRow[] {
  const rowMap = new Map<string, ProjectRow>()

  for (const entry of entries) {
    const code = entry.projectCode ?? ''
    const desc = entry.description ?? ''
    const key = `${code}|||${desc}`

    if (!rowMap.has(key)) {
      rowMap.set(key, {
        rowKey: key,
        projectCode: code,
        description: desc,
        cells: Object.fromEntries(weekDays.map((d) => [dateToIso(d), null])),
      })
    }

    const entryDateIso = entry.date.slice(0, 10)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    rowMap.get(key)!.cells[entryDateIso] = { entryId: entry.id, hours: Number.parseFloat(entry.hours) }
  }

  return Array.from(rowMap.values())
}

function formatHours(h: number): string {
  return h % 1 === 0 ? `${h}` : h.toFixed(1)
}

function handleHoursCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') e.currentTarget.blur()
}

type CellOp = 'delete' | 'create' | 'update'

function determineOperation(
  newHours: number | null,
  existing: { entryId: string; hours: number } | null,
): CellOp | null {
  if (newHours === null && existing !== null) return 'delete'
  if (newHours !== null && existing === null) return 'create'
  if (newHours !== null && existing !== null) return 'update'
  return null
}

async function apiDeleteEntry(timesheetId: string, entryId: string) {
  const res = await fetch(`/api/timesheets/${timesheetId}/entries/${entryId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error('Failed to delete entry')
}

async function apiCreateEntry(
  timesheetId: string,
  dateIso: string,
  hours: number,
  projectCode: string | null,
  description: string | null,
): Promise<string> {
  const res = await fetch(`/api/timesheets/${timesheetId}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: dateIso, hours, projectCode, description }),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error((data.error as string | undefined) ?? 'Failed to create entry')
  }
  const data = await res.json()
  return data.entry.id as string
}

function rowTotal(row: ProjectRow, weekDayIsos: string[]): number {
  return weekDayIsos.reduce((sum, iso) => sum + (row.cells[iso]?.hours ?? 0), 0)
}

async function apiUpdateEntry(
  timesheetId: string,
  entryId: string,
  hours: number,
  projectCode: string | null,
  description: string | null,
) {
  const res = await fetch(`/api/timesheets/${timesheetId}/entries/${entryId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours, projectCode, description }),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error((data.error as string | undefined) ?? 'Failed to update entry')
  }
}

// ---------------------------------------------------------------------------
// Cell input
// ---------------------------------------------------------------------------

interface HoursCellProps {
  value: number | null
  editable: boolean
  saving: boolean
  isHighlighted: boolean
  hoursLabel: string
  onCommit: (newHours: number | null) => void
}

const HoursCell = ({ value, editable, saving, isHighlighted, hoursLabel, onCommit }: Readonly<HoursCellProps>) => {
  const [localValue, setLocalValue] = useState<string>(value !== null ? String(value) : '')
  const committedRef = useRef<number | null>(value)

  useEffect(() => {
    committedRef.current = value
    setLocalValue(value !== null ? String(value) : '')
  }, [value])

  function handleBlur() {
    const trimmed = localValue.trim()
    const parsed = trimmed === '' ? null : Number.parseFloat(trimmed)
    const normalized = parsed === null || Number.isNaN(parsed) || parsed <= 0 ? null : parsed
    if (normalized === committedRef.current) return
    committedRef.current = normalized
    onCommit(normalized)
  }

  if (!editable) {
    return (
      <Box
        sx={{
          width: '100%',
          textAlign: 'center',
          py: 0.25,
          color: value ? 'text.primary' : 'text.disabled',
          fontSize: '0.875rem',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value ? formatHours(value) : '—'}
      </Box>
    )
  }

  return (
    <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {saving && (
        <CircularProgress
          size={12}
          sx={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}
        />
      )}
      <InputBase
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleHoursCellKeyDown}
        inputProps={{
          'aria-label': hoursLabel,
          min: 0,
          max: 24,
          step: 0.5,
          style: { textAlign: 'center', padding: '4px 0', width: '100%' },
        }}
        sx={{
          width: '100%',
          fontSize: '0.875rem',
          fontVariantNumeric: 'tabular-nums',
          '& input': {
            borderRadius: 0.5,
            transition: 'background-color 0.15s',
            '&:focus': {
              bgcolor: isHighlighted ? 'primary.light' : 'action.selected',
              outline: 'none',
            },
          },
        }}
        placeholder="—"
      />
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Sticky cell shared styles
// ---------------------------------------------------------------------------

const STICKY_COL_WIDTH = 280
const DAY_COL_WIDTH = 82
const TOTAL_COL_WIDTH = 72

const stickyFirstCell = {
  position: 'sticky' as const,
  left: 0,
  zIndex: 2,
  bgcolor: 'background.paper',
  minWidth: STICKY_COL_WIDTH,
  maxWidth: STICKY_COL_WIDTH,
  width: STICKY_COL_WIDTH,
  borderRight: '1px solid',
  borderRightColor: 'divider',
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const TimesheetDetailPage = ({ params }: Readonly<{ params: Promise<{ id: string }> }>) => {
  const { id } = use(params)
  const { showSnackbar } = useSnackbar()
  const t = useTranslations('timesheets')

  const [timesheet, setTimesheet] = useState<Timesheet | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set())
  const [submitLoading, setSubmitLoading] = useState(false)

  const statusLabels: Record<string, string> = {
    draft: t('status.draft'),
    submitted: t('status.submitted'),
    pending_manager_review: t('status.pendingManagerReview'),
    pending_hr_review: t('status.pendingHrReview'),
    revision_requested: t('status.revisionRequested'),
    approved: t('status.approved'),
    rejected: t('status.rejected'),
  }

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchTimesheet = useCallback(async () => {
    setLoading(true)
    setFetchError('')
    try {
      const res = await fetch(`/api/timesheets/${id}`)
      if (!res.ok) {
        const data = await res.json()
        setFetchError(data.error ?? t('detail.notFound'))
        return
      }
      const data: Timesheet = await res.json()
      setTimesheet(data)
      const weekDays = getWeekDays(data.weekStart)
      setRows(buildProjectRows(data.entries, weekDays))
    } catch {
      setFetchError(t('detail.networkError'))
    } finally {
      setLoading(false)
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchTimesheet()
  }, [fetchTimesheet])

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const status = timesheet?.status ?? ''
  const editable = status === 'draft' || status === 'revision_requested'
  const showRejection =
    (status === 'rejected' || status === 'revision_requested') && timesheet?.rejectionReason

  const weekDays = useMemo(
    () => (timesheet ? getWeekDays(timesheet.weekStart) : []),
    [timesheet?.weekStart], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const weekDayIsos = useMemo(() => weekDays.map(dateToIso), [weekDays])

  const { dayTotals, weekTotal } = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const iso of weekDayIsos) {
      totals[iso] = rows.reduce((sum, row) => sum + (row.cells[iso]?.hours ?? 0), 0)
    }
    return { dayTotals: totals, weekTotal: Object.values(totals).reduce((s, v) => s + v, 0) }
  }, [rows, weekDayIsos])

  // ---------------------------------------------------------------------------
  // Cell commit handler
  // ---------------------------------------------------------------------------

  async function handleCellCommit(rowKey: string, dateIso: string, newHours: number | null) {
    if (!editable) return
    const row = rows.find((r) => r.rowKey === rowKey)
    if (!row) return

    const existing = row.cells[dateIso] ?? null
    const cellId = `${rowKey}::${dateIso}`
    const op = determineOperation(newHours, existing)
    if (op === null) return

    const projectCode = row.projectCode || null
    const description = row.description || null

    setRows((prev) =>
      prev.map((r) =>
        r.rowKey === rowKey
          ? { ...r, cells: { ...r.cells, [dateIso]: newHours !== null ? { entryId: existing?.entryId ?? '', hours: newHours } : null } }
          : r,
      ),
    )
    setSavingCells((prev) => new Set(prev).add(cellId))

    try {
      if (op === 'delete') {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await apiDeleteEntry(id, existing!.entryId)
        setRows((prev) =>
          prev.map((r) =>
            r.rowKey === rowKey ? { ...r, cells: { ...r.cells, [dateIso]: null } } : r,
          ),
        )
      } else if (op === 'create') {
        const entryId = await apiCreateEntry(id, dateIso, newHours as number, projectCode, description)
        setRows((prev) =>
          prev.map((r) =>
            r.rowKey === rowKey
              ? { ...r, cells: { ...r.cells, [dateIso]: { entryId, hours: newHours as number } } }
              : r,
          ),
        )
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await apiUpdateEntry(id, existing!.entryId, newHours as number, projectCode, description)
      }
    } catch (err) {
      showSnackbar({ message: err instanceof Error ? err.message : t('detail.saveFailed'), severity: 'error' })
      setRows((prev) =>
        prev.map((r) =>
          r.rowKey === rowKey ? { ...r, cells: { ...r.cells, [dateIso]: existing } } : r,
        ),
      )
    } finally {
      setSavingCells((prev) => {
        const next = new Set(prev)
        next.delete(cellId)
        return next
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Row management
  // ---------------------------------------------------------------------------

  function addRow() {
    const rowKey = `__new__${Date.now()}`
    setRows((prev) => [
      ...prev,
      {
        rowKey,
        projectCode: '',
        description: '',
        cells: Object.fromEntries(weekDayIsos.map((iso) => [iso, null])),
      },
    ])
  }

  async function deleteRow(rowKey: string) {
    const row = rows.find((r) => r.rowKey === rowKey)
    if (!row) return

    const entryIds = Object.values(row.cells)
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => c.entryId)

    setRows((prev) => prev.filter((r) => r.rowKey !== rowKey))

    await Promise.all(
      entryIds.map((entryId) =>
        fetch(`/api/timesheets/${id}/entries/${entryId}`, { method: 'DELETE' }),
      ),
    )
  }

  function updateRowMeta(rowKey: string, field: 'projectCode' | 'description', value: string) {
    setRows((prev) =>
      prev.map((r) => (r.rowKey === rowKey ? { ...r, [field]: value } : r)),
    )
  }

  async function persistRowMeta(rowKey: string) {
    if (!editable) return
    const row = rows.find((r) => r.rowKey === rowKey)
    if (!row) return

    const filledCells = Object.values(row.cells).filter((c): c is NonNullable<typeof c> => c !== null)
    await Promise.all(
      filledCells.map((cell) =>
        apiUpdateEntry(id, cell.entryId, cell.hours, row.projectCode || null, row.description || null),
      ),
    )
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function handleSubmit() {
    setSubmitLoading(true)
    try {
      const res = await fetch(`/api/timesheets/${id}/submit`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        showSnackbar({ message: data.error ?? t('detail.submitFailed'), severity: 'error' })
        return
      }
      await fetchTimesheet()
    } finally {
      setSubmitLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Loading / error screens
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (fetchError || !timesheet) {
    return (
      <Box sx={{ maxWidth: 800 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
          <IconButton component={NextLink} href="/timesheets" size="small" aria-label={t('detail.backAriaLabel')}>
            <ArrowBackRoundedIcon />
          </IconButton>
          <Typography variant="h3">{t('detail.title')}</Typography>
        </Box>
        <Alert severity="error">{fetchError || t('detail.notFound')}</Alert>
      </Box>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const { startStr, endDay, year } = buildWeekRangeParts(timesheet.weekStart)
  const weekRangeLabel = `${t('detail.weekOf')} ${startStr}–${endDay}, ${year}`

  return (
    <Box sx={{ maxWidth: 1100 }}>
      {/* ── Page header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <IconButton
          component={NextLink}
          href="/timesheets"
          size="small"
          aria-label={t('detail.backAriaLabel')}
        >
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3" color="text.primary" sx={{ flex: 1 }}>
          {weekRangeLabel}
        </Typography>
        <Chip
          label={statusLabels[status] ?? status}
          color={STATUS_COLOR[status] ?? 'default'}
          size="small"
        />
      </Box>

      {/* ── Rejection / revision reason ── */}
      {showRejection && (
        <Alert severity={status === 'rejected' ? 'error' : 'warning'} sx={{ mb: 2 }}>
          <strong>{status === 'rejected' ? t('detail.rejectedLabel') : t('detail.revisionRequestedLabel')}:</strong>{' '}
          {timesheet.rejectionReason}
        </Alert>
      )}

      {/* ── Spreadsheet grid ── */}
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <TableContainer sx={{ maxHeight: 'calc(100vh - 280px)' }}>
          <Table
            stickyHeader
            size="small"
            aria-label="Weekly timesheet grid"
            sx={{ tableLayout: 'fixed', minWidth: STICKY_COL_WIDTH + DAY_COL_WIDTH * 7 + TOTAL_COL_WIDTH }}
          >
            {/* ── Column widths ── */}
            <colgroup>
              <col style={{ width: STICKY_COL_WIDTH }} />
              {weekDays.map((d) => (
                <col key={dateToIso(d)} style={{ width: DAY_COL_WIDTH }} />
              ))}
              <col style={{ width: TOTAL_COL_WIDTH }} />
            </colgroup>

            {/* ── Header ── */}
            <TableHead>
              <TableRow>
                {/* Project column header */}
                <TableCell
                  sx={{
                    ...stickyFirstCell,
                    bgcolor: 'action.hover',
                    zIndex: 3,
                    py: 1.25,
                    pl: 2,
                  }}
                >
                  <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t('detail.projectDescription')}
                  </Typography>
                </TableCell>

                {/* Day columns */}
                {weekDays.map((day) => {
                  const iso = dateToIso(day)
                  const today = isToday(day)
                  const weekend = isWeekend(day)
                  return (
                    <TableCell
                      key={iso}
                      align="center"
                      sx={{
                        py: 1,
                        bgcolor: today ? 'action.selected' : weekend ? 'background.default' : 'action.hover',
                        borderBottom: today ? '2px solid' : undefined,
                        borderBottomColor: today ? 'primary.main' : undefined,
                      }}
                    >
                      <Typography
                        variant="caption"
                        display="block"
                        fontWeight={today ? 700 : 600}
                        color={today ? 'primary.main' : weekend ? 'text.disabled' : 'text.secondary'}
                        sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1.3 }}
                      >
                        {formatDayAbbrev(day)}
                      </Typography>
                      <Typography
                        variant="caption"
                        display="block"
                        fontWeight={today ? 600 : 400}
                        color={today ? 'primary.main' : weekend ? 'text.disabled' : 'text.secondary'}
                        sx={{ lineHeight: 1.3 }}
                      >
                        {formatDayNum(day)}
                      </Typography>
                    </TableCell>
                  )
                })}

                {/* Total column */}
                <TableCell
                  align="center"
                  sx={{ py: 1.25, bgcolor: 'action.hover' }}
                >
                  <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t('detail.total')}
                  </Typography>
                </TableCell>
              </TableRow>
            </TableHead>

            {/* ── Body: one row per project ── */}
            <TableBody>
              {rows.length === 0 && !editable && (
                <TableRow>
                  <TableCell
                    colSpan={weekDays.length + 2}
                    align="center"
                    sx={{ py: 4, color: 'text.secondary' }}
                  >
                    {t('detail.noEntries')}
                  </TableCell>
                </TableRow>
              )}

              {rows.map((row) => {
                const total = rowTotal(row, weekDayIsos)
                return (
                  <TableRow
                    key={row.rowKey}
                    hover
                    sx={{
                      '&:last-child td': { borderBottom: 0 },
                      '& td': { borderBottom: '1px solid', borderBottomColor: 'divider' },
                    }}
                  >
                    {/* ── Project / description cell (sticky) ── */}
                    <TableCell sx={{ ...stickyFirstCell, py: 0.5, pl: 1, pr: 0.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {/* Project code field */}
                        <InputBase
                          value={row.projectCode}
                          onChange={(e) => updateRowMeta(row.rowKey, 'projectCode', e.target.value)}
                          onBlur={editable ? () => persistRowMeta(row.rowKey) : undefined}
                          readOnly={!editable}
                          placeholder={editable ? t('detail.codePlaceholder') : '—'}
                          inputProps={{ 'aria-label': t('detail.projectCodeAriaLabel'), style: { padding: '3px 6px' } }}
                          sx={{
                            width: 90,
                            flexShrink: 0,
                            fontSize: '0.75rem',
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            '& input': {
                              borderRadius: 0.5,
                              bgcolor: row.projectCode ? 'action.hover' : 'transparent',
                              color: 'primary.main',
                              transition: 'background-color 0.15s',
                              '&:focus': { bgcolor: 'action.selected' },
                            },
                          }}
                        />

                        {/* Description field */}
                        <InputBase
                          value={row.description}
                          onChange={(e) => updateRowMeta(row.rowKey, 'description', e.target.value)}
                          onBlur={editable ? () => persistRowMeta(row.rowKey) : undefined}
                          readOnly={!editable}
                          placeholder={editable ? t('detail.descriptionPlaceholder') : ''}
                          inputProps={{ 'aria-label': t('detail.descriptionAriaLabel'), style: { padding: '3px 6px' } }}
                          sx={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: '0.8125rem',
                            '& input': {
                              borderRadius: 0.5,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              transition: 'background-color 0.15s',
                              '&:focus': { bgcolor: 'action.selected' },
                            },
                          }}
                        />

                        {/* Delete row button */}
                        {editable && (
                          <Tooltip title={t('detail.removeRow')} placement="right">
                            <IconButton
                              size="small"
                              onClick={() => deleteRow(row.rowKey)}
                              aria-label={t('detail.deleteRowAriaLabel')}
                              sx={{ color: 'text.disabled', flexShrink: 0, '&:hover': { color: 'error.main' } }}
                            >
                              <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>

                    {/* ── Hours cells, one per day ── */}
                    {weekDays.map((day) => {
                      const iso = dateToIso(day)
                      const cell = row.cells[iso] ?? null
                      const cellId = `${row.rowKey}::${iso}`
                      const today = isToday(day)
                      const weekend = isWeekend(day)
                      return (
                        <TableCell
                          key={iso}
                          align="center"
                          sx={{
                            px: 0.5,
                            py: 0.25,
                            bgcolor: today ? 'action.selected' : weekend ? 'background.default' : undefined,
                            '&:focus-within': {
                              outline: '2px solid',
                              outlineColor: 'primary.main',
                              outlineOffset: '-2px',
                            },
                          }}
                        >
                          <HoursCell
                            value={cell?.hours ?? null}
                            editable={editable}
                            saving={savingCells.has(cellId)}
                            isHighlighted={today}
                            hoursLabel={t('detail.hoursAriaLabel')}
                            onCommit={(newHours) => handleCellCommit(row.rowKey, iso, newHours)}
                          />
                        </TableCell>
                      )
                    })}

                    {/* ── Row total ── */}
                    <TableCell
                      align="center"
                      sx={{
                        py: 0.5,
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: total > 0 ? 600 : 400,
                        color: total > 0 ? 'text.primary' : 'text.disabled',
                        fontSize: '0.875rem',
                      }}
                    >
                      {total > 0 ? `${formatHours(total)}h` : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}

              {/* ── Add project row ── */}
              {editable && (
                <TableRow sx={{ '& td': { borderBottom: 0 } }}>
                  <TableCell colSpan={weekDays.length + 2} sx={{ py: 0.75, pl: 1.5 }}>
                    <Button
                      size="small"
                      startIcon={<AddRoundedIcon />}
                      onClick={addRow}
                      sx={{ color: 'text.secondary', fontWeight: 500 }}
                    >
                      {t('detail.addRow')}
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>

            {/* ── Footer: daily totals ── */}
            <TableFooter>
              <TableRow
                sx={{
                  '& td': {
                    bgcolor: 'action.hover',
                    borderTop: '2px solid',
                    borderTopColor: 'divider',
                    position: 'sticky',
                    bottom: 0,
                    zIndex: 1,
                  },
                }}
              >
                {/* Label cell (sticky left) */}
                <TableCell
                  sx={{
                    ...stickyFirstCell,
                    bgcolor: 'action.hover',
                    zIndex: 2,
                    py: 1,
                    pl: 2,
                  }}
                >
                  <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t('detail.dailyTotal')}
                  </Typography>
                </TableCell>

                {/* Per-day totals */}
                {weekDays.map((day) => {
                  const iso = dateToIso(day)
                  const total = dayTotals[iso] ?? 0
                  const weekend = isWeekend(day)
                  return (
                    <TableCell
                      key={iso}
                      align="center"
                      sx={{
                        py: 1,
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: total > 0 ? 700 : 400,
                        fontSize: '0.875rem',
                        color: total > 0 ? 'text.primary' : 'text.disabled',
                        bgcolor: weekend ? 'background.default' : undefined,
                      }}
                    >
                      {total > 0 ? `${formatHours(total)}h` : '—'}
                    </TableCell>
                  )
                })}

                {/* Week total */}
                <TableCell
                  align="center"
                  sx={{
                    py: 1,
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    color: weekTotal > 0 ? 'primary.main' : 'text.disabled',
                  }}
                >
                  {weekTotal > 0 ? `${formatHours(weekTotal)}h` : '—'}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </TableContainer>
      </Paper>

      {/* ── Footer bar: week total summary + submit ── */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={2}
        sx={{ mt: 2 }}
      >
        <Typography variant="body2" color="text.secondary">
          {weekTotal > 0
            ? t('detail.hoursLogged', { hours: formatHours(weekTotal) })
            : t('detail.noHours')}
        </Typography>

        <Stack direction="row" alignItems="center" gap={1}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<MailRoundedIcon />}
            component={NextLink}
            href={`/messages?timesheetId=${id}`}
          >
            {t('detail.sendMessage')}
          </Button>

          {editable && (
            <Button
              variant="contained"
              color="primary"
              onClick={handleSubmit}
              disabled={submitLoading || weekTotal === 0}
              startIcon={
                submitLoading
                  ? <CircularProgress size={16} color="inherit" />
                  : <SendRoundedIcon />
              }
            >
              {submitLoading ? t('detail.submitting') : t('detail.submitForApproval')}
            </Button>
          )}
        </Stack>
      </Stack>
      <AuditLogPanel entityType="Timesheet" entityId={id} />
    </Box>
  )
}
export default TimesheetDetailPage
