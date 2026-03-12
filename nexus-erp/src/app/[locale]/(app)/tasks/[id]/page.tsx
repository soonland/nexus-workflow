import { redirect, notFound } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import IconButton from '@mui/material/IconButton'
import Grid from '@mui/material/Grid'
import Alert from '@mui/material/Alert'
import Divider from '@mui/material/Divider'

import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import { getTranslations } from 'next-intl/server'
import { db } from '@/db/client'
import { auth } from '@/auth'
import TaskDecisionForm from './TaskDecisionForm'
import ProfileUpdateCard from './ProfileUpdateCard'

interface DetailRowProps {
  label: string
  children: React.ReactNode
}

const DetailRow = ({ label, children }: DetailRowProps) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}

const TaskDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const session = await auth()
  if (!session) redirect('/login')

  const { id } = await params
  const t = await getTranslations('tasks')

  const BASE = process.env.WORKFLOW_API_URL ?? 'http://localhost:3000'
  const res = await fetch(`${BASE}/tasks/${id}`, { cache: 'no-store' })
  if (res.status === 404) notFound()
  if (!res.ok) throw new Error('Failed to load task')

  const { task, variables } = await res.json()

  const timesheet = variables.timesheetId
    ? await db.timesheet.findUnique({
        where: { id: variables.timesheetId as string },
        include: {
          employee: { include: { user: { select: { email: true } } } },
          entries: { select: { hours: true } },
        },
      })
    : null

  const profileUpdateRequest = variables.updateRequestId
    ? await db.employeeProfileUpdateRequest.findUnique({
        where: { id: variables.updateRequestId as string },
        include: { employee: { include: { user: { select: { email: true } } } } },
      })
    : null

  const isOpen = task.status === 'open' || task.status === 'claimed'

  return (
    <Box sx={{ maxWidth: 640 }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton href="/tasks" size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3">{t('detail.reviewTask')}</Typography>
      </Box>

      <Stack spacing={3}>
        {/* Task Details card */}
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
            <Typography variant="h5" sx={{ mb: 1 }}>{task.name}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
              <Chip label={task.status} size="small" color="warning" />
              <Typography variant="caption" color="text.secondary">
                Created {new Date(task.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Typography>
            </Box>

            {!isOpen && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('detail.alreadyCompleted')}
              </Alert>
            )}

            {isOpen && (
              <TaskDecisionForm taskId={id} />
            )}
          </CardContent>
        </Card>

        {/* Timesheet card */}
        {timesheet && (
          <Card sx={{ borderLeft: '3px solid', borderColor: 'primary.main' }}>
            <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
              <Typography variant="h5" sx={{ mb: 2.5 }}>{t('detail.timesheet')}</Typography>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Stack spacing={2.5} divider={<Divider />}>
                    <DetailRow label={t('detail.fields.employee')}>
                      <Typography variant="body2" fontWeight={500}>
                        {timesheet.employee.fullName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {timesheet.employee.user.email}
                      </Typography>
                    </DetailRow>
                    <DetailRow label={t('detail.fields.weekStart')}>
                      <Typography variant="body2" fontWeight={500}>
                        {timesheet.weekStart.toISOString().split('T')[0]}
                      </Typography>
                    </DetailRow>
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Stack spacing={2.5} divider={<Divider />}>
                    <DetailRow label={t('detail.fields.totalHours')}>
                      <Typography variant="body2" fontWeight={500}>
                        {timesheet.entries.reduce((s, e) => s + Number(e.hours), 0)}h
                      </Typography>
                    </DetailRow>
                    <DetailRow label={t('detail.fields.entries')}>
                      <Typography variant="body2" fontWeight={500}>
                        {timesheet.entries.length} line{timesheet.entries.length !== 1 ? 's' : ''}
                      </Typography>
                    </DetailRow>
                  </Stack>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        {/* Profile update request card */}
        {profileUpdateRequest && (
          <ProfileUpdateCard request={profileUpdateRequest} />
        )}
      </Stack>
    </Box>
  )
}
export default TaskDetailPage
