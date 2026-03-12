import * as React from 'react'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardActionArea from '@mui/material/CardActionArea'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Avatar from '@mui/material/Avatar'

import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded'
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded'
import InboxRoundedIcon from '@mui/icons-material/InboxRounded'
import PlayCircleRoundedIcon from '@mui/icons-material/PlayCircleRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded'
import FiberManualRecordRoundedIcon from '@mui/icons-material/FiberManualRecordRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import HourglassTopRoundedIcon from '@mui/icons-material/HourglassTopRounded'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import { db } from '@/db/client'
import { auth } from '@/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string
  value: number | string
  icon: React.ReactElement
  iconBg: string
  iconColor: string
  trend?: { value: number }
  href?: string
  linkLabel?: string
}

interface WorkflowStatusItem {
  status: string
  count: number
  color: string
  icon: React.ReactElement
}

interface ActivityItem {
  id: string
  title: string
  subtitle: string
  time: string
  type: 'timesheet' | 'task' | 'workflow'
  status?: string
}

// ─── KpiCard ──────────────────────────────────────────────────────────────────

const KpiCard = ({ title, value, icon, iconBg, iconColor, trend, href, linkLabel }: KpiCardProps) => {
  const inner = (
    <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: '10px',
            backgroundColor: iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {React.cloneElement(icon as React.ReactElement<{ sx?: object }>, {
            sx: { fontSize: 22, color: iconColor },
          })}
        </Box>
        {trend && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {trend.value >= 0 ? (
              <TrendingUpRoundedIcon sx={{ fontSize: 16, color: 'success.main' }} />
            ) : (
              <TrendingDownRoundedIcon sx={{ fontSize: 16, color: 'error.main' }} />
            )}
            <Typography
              variant="caption"
              sx={{ fontWeight: 600, color: trend.value >= 0 ? 'success.main' : 'error.main' }}
            >
              {trend.value >= 0 ? '+' : ''}{trend.value}%
            </Typography>
          </Box>
        )}
      </Box>

      <Typography variant="h3" sx={{ fontWeight: 700, mb: 0.5, color: 'text.primary' }}>
        {value}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {title}
      </Typography>

      {linkLabel && (
        <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography
            variant="caption"
            sx={{ color: 'primary.main', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            {linkLabel}
            <ArrowForwardRoundedIcon sx={{ fontSize: 12 }} />
          </Typography>
        </Box>
      )}
    </CardContent>
  )

  return (
    <Card>
      {href ? (
        <CardActionArea component={NextLink} href={href}>{inner}</CardActionArea>
      ) : (
        inner
      )}
    </Card>
  )
}

// ─── WorkflowStatusWidget ─────────────────────────────────────────────────────

const WorkflowStatusWidget = ({ items }: { items: WorkflowStatusItem[] }) => {
  const total = items.reduce((s, i) => s + i.count, 0)

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
          <Typography variant="h5">Workflow Instances</Typography>
          <Chip
            label={`${total} total`}
            size="small"
            sx={{ backgroundColor: 'primary.light', color: 'primary.dark' }}
          />
        </Box>
        <Stack spacing={1.5}>
          {items.map((item) => (
            <Box key={item.status}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {React.cloneElement(item.icon as React.ReactElement<{ sx?: object }>, {
                    sx: { fontSize: 16, color: item.color },
                  })}
                  <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                    {item.status}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {item.count}
                </Typography>
              </Box>
              <Box sx={{ height: 4, borderRadius: 2, backgroundColor: 'action.hover', overflow: 'hidden' }}>
                <Box
                  sx={{
                    height: '100%',
                    borderRadius: 2,
                    backgroundColor: item.color,
                    width: total > 0 ? `${(item.count / total) * 100}%` : '0%',
                    transition: 'width 0.6s ease',
                  }}
                />
              </Box>
            </Box>
          ))}
        </Stack>
        <Box sx={{ mt: 2.5, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button
            component={NextLink}
            href="/workflow/instances"
            size="small"
            endIcon={<ArrowForwardRoundedIcon />}
            sx={{ px: 0, color: 'primary.main', fontWeight: 600 }}
          >
            View all instances
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}

// ─── ActivityFeed ─────────────────────────────────────────────────────────────

const ActivityFeed = ({ items }: { items: ActivityItem[] }) => {
  const typeColor: Record<ActivityItem['type'], string> = {
    timesheet: '#4F46E5',
    task: '#F59E0B',
    workflow: '#10B981',
  }

  const statusColors: Record<string, { bg: string; text: string }> = {
    approved:  { bg: 'success.light', text: 'success.dark' },
    submitted: { bg: 'warning.light', text: 'warning.dark' },
    rejected:  { bg: 'error.light',   text: 'error.dark' },
  }

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
        <Typography variant="h5" sx={{ mb: 2.5 }}>Recent Activity</Typography>
        {items.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
            No recent activity
          </Typography>
        ) : (
          <Stack spacing={0} divider={<Divider />}>
            {items.map((item) => (
              <Box key={item.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 1.5 }}>
                <Avatar
                  sx={{
                    width: 32,
                    height: 32,
                    backgroundColor: `${typeColor[item.type]}18`,
                    flexShrink: 0,
                  }}
                >
                  <FiberManualRecordRoundedIcon sx={{ fontSize: 10, color: typeColor[item.type] }} />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                    {item.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {item.subtitle}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    {item.time}
                  </Typography>
                  {item.status && statusColors[item.status] && (
                    <Chip
                      label={item.status}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        mt: 0.25,
                        backgroundColor: statusColors[item.status].bg,
                        color: statusColors[item.status].text,
                      }}
                    />
                  )}
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Page (server component) ──────────────────────────────────────────────────

const DashboardPage = async () => {
  const session = await auth()
  const isManager = session?.user.role === 'manager'

  const [timesheetCount, submittedCount, approvedCount, recentTimesheets] = await Promise.all([
    session?.user.employeeId
      ? db.timesheet.count({ where: { employeeId: session.user.employeeId } })
      : Promise.resolve(0),
    session?.user.employeeId
      ? db.timesheet.count({ where: { employeeId: session.user.employeeId, status: 'submitted' } })
      : Promise.resolve(0),
    session?.user.employeeId
      ? db.timesheet.count({ where: { employeeId: session.user.employeeId, status: 'approved' } })
      : Promise.resolve(0),
    session?.user.employeeId
      ? db.timesheet.findMany({
          where: { employeeId: session.user.employeeId },
          orderBy: { updatedAt: 'desc' },
          take: 6,
          select: { id: true, weekStart: true, status: true, updatedAt: true },
        })
      : Promise.resolve([]),
  ])

  let pendingTaskCount = 0
  if (isManager) {
    try {
      const res = await fetch(
        `${process.env.WORKFLOW_API_URL ?? 'http://localhost:3000'}/tasks?assignee=${session.user.id}&status=open&pageSize=1`,
        { cache: 'no-store' },
      )
      if (res.ok) {
        const data = await res.json()
        pendingTaskCount = data.total ?? 0
      }
    } catch { /* degrade gracefully */ }
  }

  let workflowCounts = { running: 0, suspended: 0, completed: 0, terminated: 0 }
  if (isManager) {
    try {
      const res = await fetch(
        `${process.env.WORKFLOW_API_URL ?? 'http://localhost:3000'}/admin/instances/summary`,
        { cache: 'no-store' },
      )
      if (res.ok) workflowCounts = await res.json()
    } catch { /* degrade gracefully */ }
  }

  const activityItems: ActivityItem[] = recentTimesheets.map((ts) => ({
    id: ts.id,
    title: `Timesheet w/c ${new Date(ts.weekStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
    subtitle: 'Status updated',
    time: new Date(ts.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    type: 'timesheet' as const,
    status: ts.status,
  }))

  const workflowStatusItems: WorkflowStatusItem[] = [
    { status: 'running',    count: workflowCounts.running,    color: '#4F46E5', icon: <PlayCircleRoundedIcon /> },
    { status: 'suspended',  count: workflowCounts.suspended,  color: '#F59E0B', icon: <HourglassTopRoundedIcon /> },
    { status: 'completed',  count: workflowCounts.completed,  color: '#10B981', icon: <CheckCircleRoundedIcon /> },
    { status: 'terminated', count: workflowCounts.terminated, color: '#EF4444', icon: <CancelRoundedIcon /> },
  ]

  const cols = isManager ? 3 : 4

  return (
    <Box>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h2" sx={{ mb: 0.5 }}>Dashboard</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Welcome back{session?.user.email ? `, ${session.user.email.split('@')[0]}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          {isManager && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<InboxRoundedIcon />}
              component={NextLink}
              href="/tasks"
            >
              Open Tasks
              {pendingTaskCount > 0 && (
                <Chip
                  label={pendingTaskCount}
                  size="small"
                  color="primary"
                  sx={{ ml: 1, height: 18, fontSize: '0.65rem', fontWeight: 700 }}
                />
              )}
            </Button>
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={<AddRoundedIcon />}
            component={NextLink}
            href="/timesheets/new"
          >
            New Timesheet
          </Button>
        </Stack>
      </Box>

      {/* KPI row */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: cols }}>
          <KpiCard
            title="My Timesheets"
            value={timesheetCount}
            icon={<AccessTimeRoundedIcon />}
            iconBg="#EEF2FF"
            iconColor="#4F46E5"
            href="/timesheets"
            linkLabel="View all timesheets"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: cols }}>
          <KpiCard
            title="Pending Approval"
            value={submittedCount}
            icon={<PendingActionsRoundedIcon />}
            iconBg="#FEF3C7"
            iconColor="#D97706"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: cols }}>
          <KpiCard
            title="Approved"
            value={approvedCount}
            icon={<CheckCircleRoundedIcon />}
            iconBg="#D1FAE5"
            iconColor="#059669"
          />
        </Grid>
        {isManager && (
          <Grid size={{ xs: 12, sm: 6, md: cols }}>
            <KpiCard
              title="Tasks to Review"
              value={pendingTaskCount}
              icon={<InboxRoundedIcon />}
              iconBg="#EEF2FF"
              iconColor="#4F46E5"
              href="/tasks"
              linkLabel="Open task inbox"
            />
          </Grid>
        )}
      </Grid>

      {/* Lower row: Activity + Workflow widget */}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: isManager ? 8 : 12 }}>
          <ActivityFeed items={activityItems} />
        </Grid>
        {isManager && (
          <Grid size={{ xs: 12, md: 4 }}>
            <WorkflowStatusWidget items={workflowStatusItems} />
          </Grid>
        )}
      </Grid>
    </Box>
  )
}
export default DashboardPage
