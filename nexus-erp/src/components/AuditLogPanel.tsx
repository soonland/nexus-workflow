'use client'

import * as React from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import { useTranslations } from 'next-intl'
import type { AuditEntry } from './AuditLogTable'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AuditLogResponse {
  entries: AuditEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface Props {
  entityType: string
  entityId: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

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

// ── Component ──────────────────────────────────────────────────────────────────

const AuditLogPanel = ({ entityType, entityId }: Props) => {
  const t = useTranslations('auditLog')
  const [open, setOpen] = React.useState(false)
  const [data, setData] = React.useState<AuditLogResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [forbidden, setForbidden] = React.useState(false)

  React.useEffect(() => {
    if (!open || data) return
    setLoading(true)
    setError('')
    fetch(`/api/audit-log?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`)
      .then((res) => {
        if (res.status === 403) { setForbidden(true); return null }
        if (!res.ok) return res.json().then((d: { error?: string }) => Promise.reject(d.error ?? 'Failed to load'))
        return res.json() as Promise<AuditLogResponse>
      })
      .then((json) => { if (json) setData(json) })
      .catch((e: unknown) => setError(typeof e === 'string' ? e : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [open, data, entityType, entityId])

  if (forbidden) return null

  return (
    <Box>
      <Divider sx={{ my: 2 }} />
      <Button
        size="small"
        variant="text"
        color="inherit"
        onClick={() => setOpen((o) => !o)}
        startIcon={open ? <ExpandLessRoundedIcon fontSize="small" /> : <ExpandMoreRoundedIcon fontSize="small" />}
        sx={{ color: 'text.secondary', mb: 1 }}
      >
        {open ? t('history.hideHistory') : t('history.showHistory')}
      </Button>

      <Collapse in={open}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {error && (
          <Typography variant="body2" color="error" sx={{ py: 1 }}>
            {error}
          </Typography>
        )}
        {!loading && !error && data && (
          data.entries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('history.empty')}
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {data.entries.map((entry) => (
                <Box key={entry.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                  <Chip
                    label={t(`actions.${entry.action}`)}
                    size="small"
                    color={ACTION_COLORS[entry.action] ?? 'default'}
                    sx={{ flexShrink: 0, mt: 0.25 }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={500}>{entry.actorName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(entry.createdAt)}
                      {' · '}
                      {summariseDiff(entry.before, entry.after)}
                    </Typography>
                  </Box>
                </Box>
              ))}

              {data.totalPages > 1 && (
                <Typography variant="caption" color="text.secondary">
                  {t('pagination.page', { page: data.page, total: data.totalPages })}
                </Typography>
              )}
            </Stack>
          )
        )}
      </Collapse>
    </Box>
  )
}

export default AuditLogPanel
