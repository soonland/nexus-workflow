'use client'

import { useState, useEffect, useCallback } from 'react'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import TodayRoundedIcon from '@mui/icons-material/TodayRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'

type Timesheet = {
  id: string
  weekStart: string
  totalHours: string
  status: string
  notes: string | null
}

const STATUS_CONFIG: Record<string, { label: string; bgColor: string; borderColor: string; textColor: string }> = {
  draft: {
    label: 'Draft',
    bgColor: '#F9FAFB',
    borderColor: '#D1D5DB',
    textColor: '#6B7280',
  },
  submitted: {
    label: 'Submitted',
    bgColor: '#FFFBEB',
    borderColor: '#F59E0B',
    textColor: '#B45309',
  },
  pending_manager_review: {
    label: 'Manager Review',
    bgColor: '#EFF6FF',
    borderColor: '#3B82F6',
    textColor: '#1D4ED8',
  },
  pending_hr_review: {
    label: 'HR Review',
    bgColor: '#F5F3FF',
    borderColor: '#8B5CF6',
    textColor: '#6D28D9',
  },
  revision_requested: {
    label: 'Revision Requested',
    bgColor: '#FFF7ED',
    borderColor: '#F97316',
    textColor: '#C2410C',
  },
  approved: {
    label: 'Approved',
    bgColor: '#F0FDF4',
    borderColor: '#22C55E',
    textColor: '#15803D',
  },
  rejected: {
    label: 'Rejected',
    bgColor: '#FFF1F2',
    borderColor: '#F43F5E',
    textColor: '#BE123C',
  },
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

export default function TimesheetCalendar() {
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
          gridTemplateColumns: 'repeat(7, 1fr)',
          border: '1px solid',
          borderColor: 'divider',
          borderBottom: 'none',
          borderRadius: '8px 8px 0 0',
          overflow: 'hidden',
          bgcolor: 'grey.50',
        }}
      >
        {DAY_LABELS.map((day, i) => (
          <Box
            key={day}
            sx={{
              py: 1,
              textAlign: 'center',
              borderRight: i < 6 ? '1px solid' : 'none',
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
              {/* Day number cells */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
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
                        bgcolor: isWeekend ? 'grey.50' : 'background.paper',
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
                    </Box>
                  )
                })}
              </Box>

              {/* Timesheet badge spanning the full week */}
              <Box sx={{ px: 1, pb: 1 }}>
                {ts && statusCfg ? (
                  <Box
                    component={NextLink}
                    href={`/timesheets/${ts.id}`}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 1.5,
                      py: 0.75,
                      borderRadius: 1,
                      bgcolor: statusCfg.bgColor,
                      border: '1px solid',
                      borderColor: statusCfg.borderColor,
                      textDecoration: 'none',
                      transition: 'opacity 0.15s',
                      '&:hover': { opacity: 0.75 },
                    }}
                  >
                    <Typography variant="caption" fontWeight={700} color={statusCfg.textColor}>
                      {Number(ts.totalHours)}h
                    </Typography>
                    <Typography variant="caption" color={statusCfg.textColor} sx={{ opacity: 0.5 }}>·</Typography>
                    <Typography variant="caption" color={statusCfg.textColor}>
                      {statusCfg.label}
                    </Typography>
                    {ts.notes && (
                      <>
                        <Typography variant="caption" color={statusCfg.textColor} sx={{ opacity: 0.5 }}>·</Typography>
                        <Typography
                          variant="caption"
                          color={statusCfg.textColor}
                          sx={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}
                        >
                          {ts.notes}
                        </Typography>
                      </>
                    )}
                  </Box>
                ) : (
                  <Box
                    component={NextLink}
                    href={`/timesheets/new?weekStart=${mondayStr}`}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      px: 1.5,
                      py: 0.75,
                      borderRadius: 1,
                      border: '1px dashed',
                      borderColor: 'divider',
                      textDecoration: 'none',
                      color: 'text.disabled',
                      transition: 'all 0.15s',
                      '&:hover': {
                        borderColor: 'primary.main',
                        color: 'primary.main',
                        bgcolor: 'primary.50',
                      },
                    }}
                  >
                    <AddRoundedIcon sx={{ fontSize: 13 }} />
                    <Typography variant="caption">Log hours</Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
