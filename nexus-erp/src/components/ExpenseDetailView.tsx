'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import DeleteIcon from '@mui/icons-material/Delete'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslations, useFormatter } from 'next-intl'
import SectionLabel from './SectionLabel'

// ── Types ─────────────────────────────────────────────────────────────────────

type ExpenseStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED_MANAGER'
  | 'APPROVED_ACCOUNTING'
  | 'REJECTED'
  | 'REIMBURSED'

type Category = 'TRAVEL' | 'MEALS' | 'EQUIPMENT' | 'OTHER'
const CATEGORIES: Category[] = ['TRAVEL', 'MEALS', 'EQUIPMENT', 'OTHER']

interface LineItemData {
  id: string
  date: string // YYYY-MM-DD
  category: string
  amount: number
  description: string | null
}

interface AuditEntry {
  id: string
  action: string
  actorName: string
  createdAt: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

interface ReportData {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  employeeId: string
  lineItems: LineItemData[]
  auditLogs: AuditEntry[]
}

interface Props {
  report: ReportData
  isOwner: boolean
  title: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<
  ExpenseStatus,
  'default' | 'warning' | 'info' | 'success' | 'error'
> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  APPROVED_MANAGER: 'info',
  APPROVED_ACCOUNTING: 'success',
  REJECTED: 'error',
  REIMBURSED: 'success',
}

const ACTION_COLORS: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  CREATE: 'success',
  UPDATE: 'warning',
  DELETE: 'error',
}


interface EditItem {
  id: string
  date: Dayjs | null
  category: string
  amount: string
  description: string
}

function toEditItem(item: LineItemData): EditItem {
  return {
    id: item.id,
    date: dayjs(item.date),
    category: item.category,
    amount: String(item.amount),
    description: item.description ?? '',
  }
}

function newEditItem(): EditItem {
  return {
    id: crypto.randomUUID(),
    date: null,
    category: '',
    amount: '',
    description: '',
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

const ExpenseDetailView = ({ report, isOwner, title }: Props) => {
  const router = useRouter()
  const format = useFormatter()
  const t = useTranslations('expenses.detail')
  const tStatus = useTranslations('expenses.status')

  const [editing, setEditing] = useState(false)
  const [items, setItems] = useState<EditItem[]>(() => report.lineItems.map(toEditItem))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const status = report.status as ExpenseStatus
  const isRejected = status === 'REJECTED'
  const isDraft = status === 'DRAFT'

  // Find rejection reason from the most recent REJECTED status audit entry
  const rejectionEntry = isRejected
    ? [...report.auditLogs].reverse().find(
        (log) =>
          log.action === 'UPDATE' &&
          (log.after as Record<string, unknown> | null)?.status === 'REJECTED',
      )
    : null
  const rejectionComment =
    (rejectionEntry?.after as Record<string, unknown> | null)?.rejectionReason as string | undefined

  function setItemField<K extends keyof EditItem>(index: number, field: K, value: EditItem[K]) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
    const errorKey = `items[${index}].${field}`
    if (fieldErrors[errorKey]) {
      setFieldErrors((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([k]) => k !== errorKey)),
      )
    }
  }

  function addItem() {
    setItems((prev) => [...prev, newEditItem()])
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
    setFieldErrors((prev) => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) {
        const m = k.match(/^items\[(\d+)\](\..+)$/)
        if (!m) { next[k] = v; continue }
        const idx = Number(m[1])
        if (idx === index) continue
        const newIdx = idx > index ? idx - 1 : idx
        next[`items[${newIdx}]${m[2]}`] = v
      }
      return next
    })
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {}
    items.forEach((item, i) => {
      if (!item.date || !item.date.isValid()) {
        errs[`items[${i}].date`] = t('validation.dateRequired')
      }
      if (!item.category) {
        errs[`items[${i}].category`] = t('validation.categoryRequired')
      }
      if (!item.amount.trim()) {
        errs[`items[${i}].amount`] = t('validation.amountRequired')
      } else if (isNaN(Number(item.amount)) || Number(item.amount) <= 0) {
        errs[`items[${i}].amount`] = t('validation.amountInvalid')
      }
    })
    return errs
  }

  function handleCancelEdit() {
    setItems(report.lineItems.map(toEditItem))
    setFieldErrors({})
    setServerError(null)
    setEditing(false)
  }

  async function handleSubmitDraft() {
    setServerError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/expenses/${report.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SUBMITTED' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? t('submitFailed'))
      }
      router.refresh()
      router.push('/expenses')
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('submitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/expenses/${report.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineItems: items.map((item) => ({
            date: (item.date as Dayjs).format('YYYY-MM-DD'),
            category: item.category as Category,
            amount: Number(item.amount),
            ...(item.description.trim() ? { description: item.description.trim() } : {}),
          })),
          status: 'SUBMITTED',
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Error ${res.status}`)
      }

      router.refresh()
      router.push('/expenses')
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('resubmitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const total = report.lineItems.reduce((sum, item) => sum + item.amount, 0)

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box>
        {/* Header */}
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton href="/expenses" aria-label={t('back')} size="small">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h2" sx={{ flex: 1 }}>
            {title}
          </Typography>
          <Chip
            label={tStatus(status)}
            color={STATUS_COLORS[status] ?? 'default'}
          />
        </Box>

        {/* Rejection banner */}
        {isRejected && (
          <Alert severity="error" sx={{ mb: 3 }}>
            <Typography variant="body2" fontWeight={600}>
              {t('rejectionReason')}
            </Typography>
            <Typography variant="body2">
              {rejectionComment ?? t('noRejectionReason')}
            </Typography>
          </Alert>
        )}

        {/* Submit action button for DRAFT reports (view mode) */}
        {isDraft && isOwner && !editing && (
          <Box sx={{ mb: 3 }}>
            {serverError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {serverError}
              </Alert>
            )}
            <Button variant="contained" onClick={handleSubmitDraft} disabled={submitting}>
              {submitting ? t('submitting') : t('submit')}
            </Button>
          </Box>
        )}

        {/* Resubmit action button (view mode) */}
        {isRejected && isOwner && !editing && (
          <Box sx={{ mb: 3 }}>
            <Button variant="contained" onClick={() => setEditing(true)}>
              {t('resubmit')}
            </Button>
          </Box>
        )}

        {/* Edit / Resubmit form */}
        {editing ? (
          <Box component="form" onSubmit={handleResubmit} noValidate sx={{ mb: 4 }}>
            {serverError && (
              <Alert severity="error" sx={{ mb: 3 }}>
                {serverError}
              </Alert>
            )}
            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ p: 3 }}>
                <SectionLabel>{t('sections.lineItems')}</SectionLabel>

                {items.map((item, i) => (
                  <Box key={item.id}>
                    {i > 0 && <Divider sx={{ my: 3 }} />}
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Typography variant="subtitle2" sx={{ flex: 1 }}>
                        {t('lineItem', { number: i + 1 })}
                      </Typography>
                      {items.length > 1 && (
                        <IconButton
                          size="small"
                          onClick={() => removeItem(i)}
                          aria-label={t('removeItem')}
                          disabled={submitting}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>

                    <Grid container spacing={2.5}>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <DatePicker
                          label={t('fields.date')}
                          value={item.date}
                          onChange={(val) => setItemField(i, 'date', val)}
                          disabled={submitting}
                          slotProps={{
                            textField: {
                              required: true,
                              fullWidth: true,
                              size: 'small',
                              error: !!fieldErrors[`items[${i}].date`],
                              helperText: fieldErrors[`items[${i}].date`],
                            },
                          }}
                        />
                      </Grid>

                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          label={t('fields.category')}
                          select
                          value={item.category}
                          onChange={(e) => setItemField(i, 'category', e.target.value)}
                          required
                          fullWidth
                          size="small"
                          disabled={submitting}
                          error={!!fieldErrors[`items[${i}].category`]}
                          helperText={fieldErrors[`items[${i}].category`]}
                        >
                          {CATEGORIES.map((cat) => (
                            <MenuItem key={cat} value={cat}>
                              {t(`categories.${cat}`)}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Grid>

                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          label={t('fields.amount')}
                          type="number"
                          value={item.amount}
                          onChange={(e) => setItemField(i, 'amount', e.target.value)}
                          required
                          fullWidth
                          size="small"
                          disabled={submitting}
                          error={!!fieldErrors[`items[${i}].amount`]}
                          helperText={fieldErrors[`items[${i}].amount`]}
                          slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
                        />
                      </Grid>

                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          label={t('fields.description')}
                          value={item.description}
                          onChange={(e) => setItemField(i, 'description', e.target.value)}
                          fullWidth
                          size="small"
                          disabled={submitting}
                        />
                      </Grid>
                    </Grid>
                  </Box>
                ))}

                <Box sx={{ mt: 3 }}>
                  <Button startIcon={<AddIcon />} onClick={addItem} disabled={submitting} size="small">
                    {t('addItem')}
                  </Button>
                </Box>
              </Box>

              <Box
                sx={{
                  px: 3,
                  py: 2,
                  borderTop: 1,
                  borderColor: 'divider',
                  backgroundColor: 'background.paper',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <Button type="submit" variant="contained" disabled={submitting}>
                  {submitting ? t('submitting') : t('submitResubmit')}
                </Button>
                <Button onClick={handleCancelEdit} disabled={submitting}>
                  {t('cancelEdit')}
                </Button>
              </Box>
            </Paper>
          </Box>
        ) : (
          /* View mode: line items table */
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 4 }}>
            <Box sx={{ p: 3, pb: 1 }}>
              <SectionLabel>{t('sections.lineItems')}</SectionLabel>
            </Box>
            <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('fields.date')}</TableCell>
                  <TableCell>{t('fields.category')}</TableCell>
                  <TableCell align="right">{t('fields.amount')}</TableCell>
                  <TableCell>{t('fields.description')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.lineItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Typography variant="body2">{item.date}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{t(`categories.${item.category as Category}`)}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">{format.number(item.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {item.description ?? '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={2} />
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={600}>
                      {format.number(total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {t('fields.total')}
                    </Typography>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            </Box>
          </Paper>
        )}

        {/* Audit trail */}
        <Paper variant="outlined" sx={{ borderRadius: 2, p: 3 }}>
          <SectionLabel>{t('sections.auditTrail')}</SectionLabel>
          {report.auditLogs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('noAuditEntries')}
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {report.auditLogs.map((entry) => (
                <Box key={entry.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                  <Chip
                    label={entry.action}
                    size="small"
                    color={ACTION_COLORS[entry.action] ?? 'default'}
                    sx={{ flexShrink: 0, mt: 0.25 }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={500}>
                      {entry.actorName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {format.dateTime(new Date(entry.createdAt), { day: 'numeric', month: 'short', year: 'numeric' })}{' '}{format.dateTime(new Date(entry.createdAt), { hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                    {typeof (entry.after as Record<string, unknown> | null)?.status === 'string' && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {(entry.after as Record<string, string>).status}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Stack>
          )}
        </Paper>
      </Box>
    </LocalizationProvider>
  )
}

export default ExpenseDetailView
