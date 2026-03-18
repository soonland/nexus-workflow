'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import type { Dayjs } from 'dayjs'
import { useTranslations } from 'next-intl'
import SectionLabel from './SectionLabel'

// ── Types ────────────────────────────────────────────────────────────────────

type Category = 'TRAVEL' | 'MEALS' | 'EQUIPMENT' | 'OTHER'

const CATEGORIES: Category[] = ['TRAVEL', 'MEALS', 'EQUIPMENT', 'OTHER']

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

interface LineItemField {
  id: string
  date: Dayjs | null
  category: string
  amount: string
  description: string
  receipt: File | null
}

interface RetryItem {
  file: File
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const emptyItem = (): LineItemField => ({
  id: crypto.randomUUID(),
  date: null,
  category: '',
  amount: '',
  description: '',
  receipt: null,
})

// ── Main component ────────────────────────────────────────────────────────────

const NewExpenseForm = () => {
  const router = useRouter()
  const t = useTranslations('expenses.new')

  const [items, setItems] = useState<LineItemField[]>([emptyItem()])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [retryItems, setRetryItems] = useState<RetryItem[]>([])
  const [pendingReportId, setPendingReportId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [retrying, setRetrying] = useState(false)

  function setItemField<K extends keyof LineItemField>(
    index: number,
    field: K,
    value: LineItemField[K],
  ) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
    const errorKey = `items[${index}].${field}`
    if (fieldErrors[errorKey]) {
      setFieldErrors((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([k]) => k !== errorKey)),
      )
    }
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()])
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

  async function uploadReceipt(reportId: string, file: File): Promise<boolean> {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`/api/expenses/${reportId}/receipts`, {
      method: 'POST',
      body: formData,
    })
    return res.ok
  }

  async function handleRetry() {
    if (!pendingReportId) return
    setRetrying(true)
    try {
      const stillFailed: RetryItem[] = []
      for (const ri of retryItems) {
        const ok = await uploadReceipt(pendingReportId, ri.file)
        if (!ok) stillFailed.push(ri)
      }
      setRetryItems(stillFailed)
      if (stillFailed.length === 0) {
        router.push(`/expenses/${pendingReportId}`)
      }
    } finally {
      setRetrying(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineItems: items.map((item) => ({
            date: (item.date as Dayjs).format('YYYY-MM-DD'),
            category: item.category as Category,
            amount: Number(item.amount),
            ...(item.description.trim() ? { description: item.description.trim() } : {}),
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Error ${res.status}`)
      }

      const data = (await res.json()) as { report: { id: string } }
      const reportId = data.report.id

      // Upload receipts for each item that has a file attached
      const failed: RetryItem[] = []
      for (const item of items) {
        if (item.receipt) {
          const ok = await uploadReceipt(reportId, item.receipt)
          if (!ok) failed.push({ file: item.receipt })
        }
      }

      if (failed.length > 0) {
        setPendingReportId(reportId)
        setRetryItems(failed)
        return
      }

      router.push(`/expenses/${reportId}`)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('createFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box component="form" onSubmit={handleSubmit} noValidate>
        {serverError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {serverError}
          </Alert>
        )}

        {retryItems.length > 0 && (
          <Alert
            severity="warning"
            sx={{ mb: 3 }}
            action={
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Button
                  color="inherit"
                  size="small"
                  onClick={handleRetry}
                  disabled={retrying}
                >
                  {retrying ? t('retrying') : t('retryUpload')}
                </Button>
                {pendingReportId && (
                  <Button
                    color="inherit"
                    size="small"
                    href={`/expenses/${pendingReportId}`}
                  >
                    {t('viewReport')}
                  </Button>
                )}
              </Box>
            }
          >
            {t('receiptUploadFailed', { count: retryItems.length })}
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
                      slotProps={{ htmlInput: { min: 0.01, step: 0.01, 'aria-required': true } }}
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

                  <Grid size={{ xs: 12 }}>
                    <Button
                      variant="outlined"
                      component="label"
                      size="small"
                      disabled={submitting}
                    >
                      {item.receipt ? item.receipt.name : t('fields.receipt')}
                      <input
                        type="file"
                        hidden
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        aria-describedby={fieldErrors[`items[${i}].receipt`] ? `receipt-error-${i}` : undefined}
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null
                          if (file && file.size > MAX_FILE_SIZE) {
                            setFieldErrors((prev) => ({
                              ...prev,
                              [`items[${i}].receipt`]: t('validation.fileTooLarge'),
                            }))
                            e.target.value = ''
                            return
                          }
                          setFieldErrors((prev) =>
                            Object.fromEntries(
                              Object.entries(prev).filter(([k]) => k !== `items[${i}].receipt`),
                            ),
                          )
                          setItemField(i, 'receipt', file)
                        }}
                      />
                    </Button>
                    {fieldErrors[`items[${i}].receipt`] && (
                      <Typography id={`receipt-error-${i}`} variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                        {fieldErrors[`items[${i}].receipt`]}
                      </Typography>
                    )}
                  </Grid>
                </Grid>
              </Box>
            ))}

            <Box sx={{ mt: 3 }}>
              <Button
                startIcon={<AddIcon />}
                onClick={addItem}
                disabled={submitting}
                size="small"
              >
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
              {submitting ? t('submitting') : t('submit')}
            </Button>
            <Button href="/expenses" disabled={submitting}>
              {t('cancel')}
            </Button>
          </Box>
        </Paper>
      </Box>
    </LocalizationProvider>
  )
}

export default NewExpenseForm
