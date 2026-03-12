'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import Tooltip from '@mui/material/Tooltip'
import { useTheme, alpha } from '@mui/material/styles'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import TodayRoundedIcon from '@mui/icons-material/TodayRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'

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

function useStatusConfig(): Record<string, StatusCfg> {
  const theme = useTheme()
  const { palette } = theme
  const isDark = palette.mode === 'dark'

  if (!isDark) {
    return {
      draft:                  { label: 'Draft',            bgColor: '#F9FAFB',                                    borderColor: '#D1D5DB',                          textColor: '#6B7280' },
      submitted:              { label: 'Submitted',        bgColor: '#FFFBEB',                                    borderColor: '#F59E0B',                          textColor: '#B45309' },
      pending_manager_review: { label: 'Manager Review',   bgColor: '#EFF6FF',                                    borderColor: '#3B82F6',                          textColor: '#1D4ED8' },
      pending_hr_review:      { label: 'HR Review',        bgColor: '#F5F3FF',                                    borderColor: '#8B5CF6',                          textColor: '#6D28D9' },
      revision_requested:     { label: 'Revision Request', bgColor: '#FFF7ED',                                    borderColor: '#F97316',                          textColor: '#C2410C' },
      approved:               { label: 'Approved',         bgColor: '#F0FDF4',                                    borderColor: '#22C55E',                          textColor: '#15803D' },
      rejected:               { label: 'Rejected',         bgColor: '#FFF1F2',                                    borderColor: '#F43F5E',                          textColor: '#BE123C' },
    }
  }

  return {
    draft:                  { label: 'Draft',            bgColor: alpha(palette.grey[500], 0.12),            borderColor: alpha(palette.grey[500], 0.35),     textColor: palette.grey[400] },
    submitted:              { label: 'Submitted',        bgColor: alpha(palette.warning.main, 0.12),         borderColor: alpha(palette.warning.main, 0.45),  textColor: palette.warning.light },
    pending_manager_review: { label: 'Manager Review',   bgColor: alpha(palette.info.main, 0.12),            borderColor: alpha(palette.info.main, 0.45),     textColor: palette.info.light },
    pending_hr_review:      { label: 'HR Review',        bgColor: alpha(palette.secondary.main, 0.12),       borderColor: alpha(palette.secondary.main, 0.45), textColor: palette.secondary.light },
    revision_requested:     { label: 'Revision Request', bgColor: alpha(palette.warning.dark, 0.15),         borderColor: alpha(palette.warning.dark, 0.5),   textColor: palette.warning.main },
    approved:               { label: 'Approved',         bgColor: alpha(palette.success.main, 0.12),         borderColor: alpha(palette.success.main, 0.45),  textColor: palette.success.light },
    rejected:               { label: 'Rejected',         bgColor: alpha(palette.error.main, 0.12),           borderColor: alpha(palette.error.main, 0.45),    textColor: palette.error.light },
  }
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function getCalendarWeeks(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const dayOfWeek = firstDay.getDay() // 0=Sun, 1=Mon
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const firstMonday = addDays(firstDay, daysToMonday)
  const weeks: Date[] = []
  let current = new Date(firstMonday)
  while (current <= lastDay) {
    weeks.push(new Date(current))
    current = addDays(current, 7)
  }
  return weeks
}

function getCalendarRange(year: number, month: number): { from: string; to: string } {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const dayOfWeek = firstDay.getDay()
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const firstMonday = addDays(firstDay, daysToMonday)
  const lastDayOfWeek = lastDay.getDay()
  const daysToSunday = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek
  const lastSunday = addDays(lastDay, daysToSunday)
  return { from: formatDate(firstMonday), to: formatDate(lastSunday) }
}

const TimesheetCalendar = () => {
  const STATUS_CONFIG = useStatusConfig()
  const today = new Date()
  const [viewDate, setViewDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(false)

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const weeks = getCalendarWeeks(year, month)

  const fetchTimesheets = useCallback(async () => {
    setLoading(true)
    const { from, to } = getCalendarRange(year, month)
    const res = await fetch(`/api/timesheets?from=${from}&to=${to}`)
    if (res.ok) {
      setTimesheets(await res.json())
    }
    setLoading(false)
  }, [year, month])

  useEffect(() => { fetchTimesheets() }, [fetchTimesheets])

  const todayStr = formatDate(today)

  const [summaryOpen, setSummaryOpen] = useState(true)
  // Re-open when the user navigates to a different month
  const prevMonthKey = useRef(`${year}-${month}`)
  if (`${year}-${month}` !== prevMonthKey.current) {
    prevMonthKey.current = `${year}-${month}`
    setSummaryOpen(true)
  }

  // Aggregate all entries across visible timesheets, grouped by project
  const monthlySummary = useMemo(() => {
    const map = new Map<string, { projectCode: string; description: string; hours: number }>()
    for (const ts of timesheets) {
      for (const e of ts.entries) {
        const key = `${e.projectCode ?? ''}|||${e.description ?? ''}`
        const existing = map.get(key)
        if (existing) {
          existing.hours += e.hours
        } else {
          map.set(key, {
            projectCode: e.projectCode ?? '',
            description: e.description ?? '',
            hours: e.hours,
          })
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.hours - a.hours)
  }, [timesheets])

  const monthlyTotal = monthlySummary.reduce((sum, row) => sum + row.hours, 0)

  // Map dateStr → array of { entry, statusCfg } for quick day-cell lookup
  const dateToEntries = useMemo(() => {
    const map = new Map<string, Array<{ entry: TimesheetEntry; statusCfg: typeof STATUS_CONFIG[string] }>>()
    for (const ts of timesheets) {
      const cfg = STATUS_CONFIG[ts.status] ?? STATUS_CONFIG.draft
      for (const entry of ts.entries) {
        const list = map.get(entry.date) ?? []
        list.push({ entry, statusCfg: cfg })
        map.set(entry.date, list)
      }
    }
    return map
  }, [timesheets])

  return (
    <Box>
      {/* Month navigation */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 3 }}>
        <IconButton onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} size="small">
          <ChevronLeftRoundedIcon />
        </IconButton>
        <Typography variant="h5" sx={{ minWidth: 220, textAlign: 'center', fontWeight: 600 }}>
          {MONTH_NAMES[month]} {year}
        </Typography>
        <IconButton onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} size="small">
          <ChevronRightRoundedIcon />
        </IconButton>
        <Tooltip title="Go to current month">
          <IconButton
            onClick={() => setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))}
            size="small"
            sx={{ ml: 0.5 }}
          >
            <TodayRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {loading && <CircularProgress size={16} sx={{ ml: 1 }} />}
      </Box>

      {/* Day-of-week headers */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr) minmax(96px, auto)',
          border: '1px solid',
          borderColor: 'divider',
          borderBottom: 'none',
          borderRadius: '8px 8px 0 0',
          overflow: 'hidden',
          bgcolor: 'action.hover',
        }}
      >
        {DAY_LABELS.map((day, i) => (
          <Box
            key={day}
            sx={{
              py: 1,
              textAlign: 'center',
              borderRight: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography
              variant="caption"
              fontWeight={600}
              color={i >= 5 ? 'text.disabled' : 'text.secondary'}
              sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              {day}
            </Typography>
          </Box>
        ))}
        <Box sx={{ py: 1, textAlign: 'center' }}>
          <Typography
            variant="caption"
            fontWeight={600}
            color="text.secondary"
            sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            Week
          </Typography>
        </Box>
      </Box>

      {/* Calendar weeks */}
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '0 0 8px 8px',
          overflow: 'hidden',
        }}
      >
        {weeks.map((monday, weekIdx) => {
          const mondayStr = formatDate(monday)
          const ts = timesheets.find(t => t.weekStart.split('T')[0] === mondayStr)
          const statusCfg = ts ? (STATUS_CONFIG[ts.status] ?? STATUS_CONFIG.draft) : null
          const isLast = weekIdx === weeks.length - 1

          return (
            <Box
              key={monday.toISOString()}
              sx={{ borderBottom: isLast ? 'none' : '1px solid', borderColor: 'divider' }}
            >
              {/* Day number cells + week summary column */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr) minmax(96px, auto)' }}>
                {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                  const day = addDays(monday, offset)
                  const dayStr = formatDate(day)
                  const isToday = dayStr === todayStr
                  const isCurrentMonth = day.getMonth() === month
                  const isWeekend = offset >= 5

                  return (
                    <Box
                      key={offset}
                      sx={{
                        px: 1,
                        pt: 1,
                        pb: 0.5,
                        minHeight: 48,
                        bgcolor: isWeekend ? 'action.hover' : 'background.paper',
                        borderRight: offset < 6 ? '1px solid' : 'none',
                        borderColor: 'divider',
                        opacity: isCurrentMonth ? 1 : 0.45,
                      }}
                    >
                      <Box
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          bgcolor: isToday ? 'primary.main' : 'transparent',
                        }}
                      >
                        <Typography
                          variant="body2"
                          fontWeight={isToday ? 700 : isCurrentMonth ? 500 : 400}
                          color={isToday ? 'primary.contrastText' : isCurrentMonth ? 'text.primary' : 'text.disabled'}
                          sx={{ fontSize: '0.8rem' }}
                        >
                          {day.getDate()}
                        </Typography>
                      </Box>
                      {/* Entry stack */}
                      {(() => {
                        const dayEntries = dateToEntries.get(dayStr)
                        if (!dayEntries?.length) return null
                        return (
                          <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                            {dayEntries.map(({ entry, statusCfg }, i) => (
                              <Box
                                key={i}
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 0.5,
                                  px: 0.75,
                                  py: 0.125,
                                  borderRadius: 0.5,
                                  bgcolor: statusCfg.bgColor,
                                  border: '1px solid',
                                  borderColor: statusCfg.borderColor,
                                  overflow: 'hidden',
                                }}
                              >
                                {entry.projectCode && (
                                  <Typography
                                    component="span"
                                    sx={{
                                      fontSize: '0.6rem',
                                      fontFamily: 'monospace',
                                      fontWeight: 700,
                                      color: statusCfg.textColor,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {entry.projectCode}
                                  </Typography>
                                )}
                                <Typography
                                  component="span"
                                  sx={{
                                    fontSize: '0.6rem',
                                    color: statusCfg.textColor,
                                    opacity: entry.projectCode ? 0.7 : 1,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    flex: entry.projectCode ? 1 : 'none',
                                  }}
                                >
                                  {entry.hours % 1 === 0 ? entry.hours : entry.hours.toFixed(1)}h
                                  {!entry.projectCode && entry.description ? ` · ${entry.description}` : ''}
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        )
                      })()}
                    </Box>
                  )
                })}

                {/* Week summary — 8th column */}
                <Box
                  sx={{
                    borderLeft: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'action.hover',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    px: 1,
                    py: 1,
                  }}
                >
                  {ts && statusCfg ? (
                    <Box
                      component={NextLink}
                      href={`/timesheets/${ts.id}`}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.25,
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        bgcolor: statusCfg.bgColor,
                        border: '1px solid',
                        borderColor: statusCfg.borderColor,
                        textDecoration: 'none',
                        transition: 'opacity 0.15s',
                        '&:hover': { opacity: 0.75 },
                        width: '100%',
                      }}
                    >
                      <Typography variant="caption" fontWeight={700} color={statusCfg.textColor}>
                        {Number(ts.totalHours)}h
                      </Typography>
                      <Typography variant="caption" color={statusCfg.textColor} sx={{ opacity: 0.75, fontSize: '0.65rem' }}>
                        {statusCfg.label}
                      </Typography>
                    </Box>
                  ) : (
                    <Box
                      component={NextLink}
                      href={`/timesheets/new?weekStart=${mondayStr}`}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.25,
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        border: '1px dashed',
                        borderColor: 'divider',
                        textDecoration: 'none',
                        color: 'text.disabled',
                        transition: 'all 0.15s',
                        width: '100%',
                        '&:hover': {
                          borderColor: 'primary.main',
                          color: 'primary.main',
                          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
                        },
                      }}
                    >
                      <AddRoundedIcon sx={{ fontSize: 14 }} />
                      <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Log hours</Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          )
        })}
      </Box>

      {/* Monthly summary by project */}
      {monthlySummary.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Box
            onClick={() => setSummaryOpen((o) => !o)}
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
            <Typography variant="subtitle2" fontWeight={600}>
              Monthly summary
            </Typography>
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
                  <Chip
                    label={row.projectCode}
                    size="small"
                    variant="outlined"
                    sx={{ fontFamily: 'monospace', fontSize: '0.7rem', height: 22, flexShrink: 0 }}
                  />
                )}
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                  {row.description || '—'}
                </Typography>
                <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {row.hours % 1 === 0 ? row.hours : row.hours.toFixed(1)}h
                </Typography>
              </Box>
            ))}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                py: 1,
                bgcolor: 'action.hover',
                borderTop: '2px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2" fontWeight={600} color="text.secondary">Total</Typography>
              <Typography variant="body2" fontWeight={700} color="primary">
                {monthlyTotal % 1 === 0 ? monthlyTotal : monthlyTotal.toFixed(1)}h
              </Typography>
            </Box>
          </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  )
}
export default TimesheetCalendar
