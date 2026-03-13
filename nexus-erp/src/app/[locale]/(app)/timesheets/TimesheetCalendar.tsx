'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha, styled, useTheme } from '@mui/material/styles'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar'
import { PickersDay, type PickersDayProps } from '@mui/x-date-pickers/PickersDay'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import 'dayjs/locale/fr'
import 'dayjs/locale/en'
import 'dayjs/locale/es'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'

dayjs.extend(isoWeek)

// ── Types ─────────────────────────────────────────────────────────────────────

type TimesheetEntry = {
  date: string
  hours: number
  projectCode: string | null
  description: string | null
}

type Timesheet = {
  id: string
  weekStart: string
  totalHours: number
  status: string
  entries: TimesheetEntry[]
}

type StatusCfg = { label: string; bgColor: string; borderColor: string; textColor: string }

// ── Status colour config ───────────────────────────────────────────────────────

function useStatusConfig(): Record<string, StatusCfg> {
  const theme = useTheme()
  const { palette } = theme
  const isDark = palette.mode === 'dark'
  const t = useTranslations('timesheets.status')

  if (!isDark) {
    return {
      draft:                  { label: t('draft'),               bgColor: '#F9FAFB',                              borderColor: '#D1D5DB',                         textColor: '#6B7280' },
      submitted:              { label: t('submitted'),           bgColor: '#FFFBEB',                              borderColor: '#F59E0B',                         textColor: '#B45309' },
      pending_manager_review: { label: t('pendingManagerReview'), bgColor: '#EFF6FF',                              borderColor: '#3B82F6',                         textColor: '#1D4ED8' },
      pending_hr_review:      { label: t('pendingHrReview'),     bgColor: '#F5F3FF',                              borderColor: '#8B5CF6',                         textColor: '#6D28D9' },
      revision_requested:     { label: t('revisionRequest'),     bgColor: '#FFF7ED',                              borderColor: '#F97316',                         textColor: '#C2410C' },
      approved:               { label: t('approved'),            bgColor: '#F0FDF4',                              borderColor: '#22C55E',                         textColor: '#15803D' },
      rejected:               { label: t('rejected'),            bgColor: '#FFF1F2',                              borderColor: '#F43F5E',                         textColor: '#BE123C' },
    }
  }

  return {
    draft:                  { label: t('draft'),               bgColor: alpha(palette.grey[500], 0.12),         borderColor: alpha(palette.grey[500], 0.35),    textColor: palette.grey[400] },
    submitted:              { label: t('submitted'),           bgColor: alpha(palette.warning.main, 0.12),      borderColor: alpha(palette.warning.main, 0.45), textColor: palette.warning.light },
    pending_manager_review: { label: t('pendingManagerReview'), bgColor: alpha(palette.info.main, 0.12),         borderColor: alpha(palette.info.main, 0.45),    textColor: palette.info.light },
    pending_hr_review:      { label: t('pendingHrReview'),     bgColor: alpha(palette.secondary.main, 0.12),    borderColor: alpha(palette.secondary.main, 0.45), textColor: palette.secondary.light },
    revision_requested:     { label: t('revisionRequest'),     bgColor: alpha(palette.warning.dark, 0.15),      borderColor: alpha(palette.warning.dark, 0.5),  textColor: palette.warning.main },
    approved:               { label: t('approved'),            bgColor: alpha(palette.success.main, 0.12),      borderColor: alpha(palette.success.main, 0.45), textColor: palette.success.light },
    rejected:               { label: t('rejected'),            bgColor: alpha(palette.error.main, 0.12),        borderColor: alpha(palette.error.main, 0.45),   textColor: palette.error.light },
  }
}

// ── Custom day slot ────────────────────────────────────────────────────────────

interface DayEntry {
  hours: number
  projectCode: string | null
  description: string | null
  bgColor: string
  borderColor: string
  textColor: string
}

interface TimesheetDayProps extends PickersDayProps {
  dayData?: DayEntry[]
}

const CELL_HEIGHT = 80

const TileDay = styled(PickersDay, {
  shouldForwardProp: (prop) => prop !== 'dayData',
})<TimesheetDayProps>(({ theme, outsideCurrentMonth }) => ({
  width: '100%',
  height: CELL_HEIGHT,
  maxWidth: 'none',
  margin: 0,
  borderRadius: theme.shape.borderRadius,
  border: `1px solid ${theme.palette.divider}`,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  padding: theme.spacing(0.5),
  backgroundColor: outsideCurrentMonth ? theme.palette.action.hover : undefined,
  '&.Mui-selected': {
    backgroundColor: alpha(theme.palette.primary.main, 0.15),
    color: theme.palette.text.primary,
    borderColor: theme.palette.primary.main,
    '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.25) },
  },
  '&.MuiPickersDay-today': {
    border: `2px solid ${theme.palette.primary.main}`,
  },
})) as React.ComponentType<TimesheetDayProps>

const TimesheetDay = ({ dayData, day, outsideCurrentMonth, ...props }: TimesheetDayProps) => {
  const entries = !outsideCurrentMonth ? (dayData ?? []) : []
  return (
    <TileDay
      {...props}
      day={day}
      outsideCurrentMonth={outsideCurrentMonth}
      disableMargin
      dayData={dayData}
    >
      {/* Day number — must be explicit because passing children replaces PickersDay's default */}
      <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-end', pr: 0.25 }}>
        <Typography
          component="span"
          aria-hidden
          sx={{
            fontSize: '0.72rem',
            lineHeight: 1.2,
            color: outsideCurrentMonth ? 'text.disabled' : 'inherit',
          }}
        >
          {day.format('D')}
        </Typography>
      </Box>
      {/* Entry chips */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%', overflow: 'hidden', mt: '2px' }}>
        {entries.map((entry, i) => {
          const tooltipParts = [entry.projectCode, entry.description].filter(Boolean)
          const tooltip = tooltipParts.length > 0 ? tooltipParts.join(' — ') : undefined
          return (
            <Tooltip key={i} title={tooltip ?? ''} placement="top" disableHoverListener={!tooltip}>
              <Box
                sx={{
                  px: '4px',
                  py: '1px',
                  borderRadius: '3px',
                  bgcolor: entry.bgColor,
                  border: '1px solid',
                  borderColor: entry.borderColor,
                  overflow: 'hidden',
                }}
              >
                <Typography
                  component="span"
                  sx={{ fontSize: '0.6rem', fontWeight: 600, color: entry.textColor, whiteSpace: 'nowrap', display: 'block' }}
                >
                  {entry.hours % 1 === 0 ? entry.hours : entry.hours.toFixed(1)}h
                </Typography>
              </Box>
            </Tooltip>
          )
        })}
      </Box>
    </TileDay>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

const TimesheetCalendar = () => {
  const STATUS_CONFIG = useStatusConfig()
  const t = useTranslations('timesheets')
  const locale = useLocale()
  const router = useRouter()

  const [viewDate, setViewDate] = useState(() => dayjs())
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(false)

  const fetchTimesheets = useCallback(async () => {
    setLoading(true)
    const from = viewDate.startOf('month').startOf('isoWeek').format('YYYY-MM-DD')
    const to   = viewDate.endOf('month').endOf('isoWeek').format('YYYY-MM-DD')
    const res = await fetch(`/api/timesheets?from=${from}&to=${to}`)
    if (res.ok) setTimesheets(await res.json())
    setLoading(false)
  }, [viewDate])

  useEffect(() => { fetchTimesheets() }, [fetchTimesheets])

  // Entry data per calendar day
  const dayDataMap = useMemo(() => {
    const map = new Map<string, DayEntry[]>()
    for (const ts of timesheets) {
      const cfg = STATUS_CONFIG[ts.status] ?? STATUS_CONFIG.draft
      for (const entry of ts.entries) {
        const list = map.get(entry.date) ?? []
        list.push({ hours: entry.hours, projectCode: entry.projectCode, description: entry.description, bgColor: cfg.bgColor, borderColor: cfg.borderColor, textColor: cfg.textColor })
        map.set(entry.date, list)
      }
    }
    return map
  }, [timesheets, STATUS_CONFIG])

  // Monthly project summary
  const [summaryOpen, setSummaryOpen] = useState(true)
  const prevMonthKey = useRef(`${viewDate.year()}-${viewDate.month()}`)
  if (`${viewDate.year()}-${viewDate.month()}` !== prevMonthKey.current) {
    prevMonthKey.current = `${viewDate.year()}-${viewDate.month()}`
    setSummaryOpen(true)
  }

  const monthlySummary = useMemo(() => {
    const map = new Map<string, { projectCode: string; description: string; hours: number }>()
    for (const ts of timesheets) {
      for (const e of ts.entries) {
        const key = `${e.projectCode ?? ''}|||${e.description ?? ''}`
        const existing = map.get(key)
        if (existing) existing.hours += e.hours
        else map.set(key, { projectCode: e.projectCode ?? '', description: e.description ?? '', hours: e.hours })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.hours - a.hours)
  }, [timesheets])

  const monthlyTotal = monthlySummary.reduce((sum, row) => sum + row.hours, 0)

  const handleDayClick = (date: Dayjs | null) => {
    if (!date) return
    const weekStart = date.startOf('isoWeek').format('YYYY-MM-DD')
    const ts = timesheets.find(t => t.weekStart.split('T')[0] === weekStart)
    if (ts) router.push(`/timesheets/${ts.id}`)
    else router.push(`/timesheets/new?weekStart=${weekStart}`)
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={locale}>
      <Box>

        {/* ── Calendar ─────────────────────────────────────────────────────── */}
        <Box sx={{ position: 'relative', flex: '1 1 320px', minWidth: 280 }}>
          {loading && (
            <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
              <CircularProgress size={16} />
            </Box>
          )}
          <DateCalendar
            value={null}
            referenceDate={viewDate}
            onChange={handleDayClick}
            onMonthChange={(date: Dayjs) => setViewDate(date)}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            slots={{ day: TimesheetDay as React.ComponentType<any> }}
            slotProps={{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              day: ((ownerState: { day: Dayjs }) => ({
                dayData: dayDataMap.get(ownerState.day.format('YYYY-MM-DD')),
              })) as unknown as undefined,
            }}
            showDaysOutsideCurrentMonth
            fixedWeekNumber={6}
            sx={{
              width: '100%',
              maxWidth: 'none',
              maxHeight: 'none',
              height: 'auto',
              overflow: 'visible',
              // inner containers all need overflow visible + auto height
              '& .MuiDayCalendar-root': {
                overflow: 'visible',
              },
              '& .MuiDayCalendar-header': {
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
              },
              '& .MuiDayCalendar-weekDayLabel': {
                width: '100%',
                justifyContent: 'center',
              },
              '& .MuiPickersSlideTransition-root, & .MuiDayCalendar-slideTransition': {
                minHeight: CELL_HEIGHT * 6,
                height: 'auto',
                overflow: 'visible',
              },
              '& .MuiDayCalendar-monthContainer': {
                overflow: 'visible',
              },
              '& .MuiDayCalendar-weekContainer': {
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                margin: 0,
                alignItems: 'stretch',
              },
              '& .MuiPickersDay-root': {
                width: '100%',
                height: CELL_HEIGHT,
                maxWidth: 'none',
              },
              '& .MuiPickersDay-dayWithMargin': { margin: 0 },
            }}
          />
        </Box>

      </Box>

      {/* ── Monthly project summary ────────────────────────────────────────── */}
      {monthlySummary.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Box
            onClick={() => setSummaryOpen(o => !o)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: summaryOpen ? 1.5 : 0,
              cursor: 'pointer',
              userSelect: 'none',
              '&:hover': { opacity: 0.75 },
            }}
          >
            <Typography variant="subtitle2" fontWeight={600} color="text.primary">{t('calendar.monthlySummary')}</Typography>
            {summaryOpen ? <ExpandLessRoundedIcon fontSize="small" /> : <ExpandMoreRoundedIcon fontSize="small" />}
          </Box>
          <Collapse in={summaryOpen}>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              {monthlySummary.map((row, idx) => (
                <Box
                  key={`${row.projectCode}|||${row.description}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2,
                    py: 1,
                    borderBottom: idx < monthlySummary.length - 1 ? '1px solid' : 'none',
                    borderColor: 'divider',
                  }}
                >
                  {row.projectCode && (
                    <Chip label={row.projectCode} size="small" variant="outlined" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', height: 20, flexShrink: 0, alignSelf: 'center' }} />
                  )}
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 1, alignSelf: 'center' }}>{row.description || '—'}</Typography>
                  <Typography variant="body2" fontWeight={600} color="text.primary" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                    {row.hours % 1 === 0 ? row.hours : row.hours.toFixed(1)}h
                  </Typography>
                </Box>
              ))}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'action.hover', borderTop: '2px solid', borderColor: 'divider' }}>
                <Typography variant="body2" fontWeight={600} color="text.secondary">{t('calendar.total')}</Typography>
                <Typography variant="body2" fontWeight={700} color="primary">
                  {monthlyTotal % 1 === 0 ? monthlyTotal : monthlyTotal.toFixed(1)}h
                </Typography>
              </Box>
            </Box>
          </Collapse>
        </Box>
      )}
    </LocalizationProvider>
  )
}
export default TimesheetCalendar
