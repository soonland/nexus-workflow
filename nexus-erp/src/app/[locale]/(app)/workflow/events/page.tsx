'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import CircularProgress from '@mui/material/CircularProgress'
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { useTranslations } from 'next-intl'
import { useSnackbar } from '@/components/SnackbarContext'

interface StoredEvent {
  id: string
  type: string
  occurredAt: string
  data: Record<string, unknown>
}

const EventLogPage = () => {
  const { showSnackbar } = useSnackbar()
  const t = useTranslations('workflow.events')
  const [instanceId, setInstanceId] = useState('')
  const [loading, setLoading] = useState(false)
  const [events, setEvents] = useState<StoredEvent[] | null>(null)

  async function search() {
    if (!instanceId.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/workflow/instances/${instanceId.trim()}/events`)
      if (res.status === 404) {
        showSnackbar({ message: t('instanceNotFound', { instanceId: instanceId.trim() }), severity: 'error' })
        setEvents(null)
      } else if (!res.ok) {
        showSnackbar({ message: t('fetchFailed'), severity: 'error' })
        setEvents(null)
      } else {
        const data = await res.json()
        setEvents(data.events ?? [])
      }
    } catch {
      showSnackbar({ message: t('networkError'), severity: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 3 }}>{t('title')}</Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
          <Typography variant="h6" sx={{ mb: 2 }}>{t('searchByInstance')}</Typography>
          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              label={t('instanceIdLabel')}
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              sx={{ flex: 1, maxWidth: 480, fontFamily: 'monospace' }}
              slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
            />
            <Button
              variant="contained"
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SearchRoundedIcon />}
              onClick={search}
              disabled={loading || !instanceId.trim()}
            >
              {t('search')}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {events === null && (
        <Stack alignItems="center" spacing={2} sx={{ py: 8 }}>
          <TimelineRoundedIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
          <Typography variant="body1" color="text.secondary">
            {t('placeholder')}
          </Typography>
        </Stack>
      )}

      {events !== null && (
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 0 } }}>
            <Typography variant="h6" sx={{ mb: 0 }}>
              {t('eventsCount', { count: events.length })} <code style={{ fontSize: '0.85em' }}>{instanceId}</code>
            </Typography>
          </CardContent>
          {events.length === 0 ? (
            <CardContent>
              <Typography variant="body2" color="text.secondary">{t('noEvents')}</Typography>
            </CardContent>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('columns.number')}</TableCell>
                  <TableCell>{t('columns.time')}</TableCell>
                  <TableCell>{t('columns.eventType')}</TableCell>
                  <TableCell>{t('columns.element')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map((ev, i) => (
                  <TableRow key={ev.id}>
                    <TableCell sx={{ color: 'text.disabled', fontSize: '0.75rem' }}>{i + 1}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(ev.occurredAt).toLocaleTimeString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={ev.type} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}>
                      {ev.data.elementId as string ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </Box>
  )
}
export default EventLogPage
