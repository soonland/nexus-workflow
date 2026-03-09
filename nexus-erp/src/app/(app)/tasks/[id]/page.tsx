import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db/client'
import NextLink from 'next/link'
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
import TaskDecisionForm from './TaskDecisionForm'

interface DetailRowProps {
  label: string
  children: React.ReactNode
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const { id } = await params

  const BASE = process.env.WORKFLOW_API_URL ?? 'http://localhost:3000'
  const res = await fetch(`${BASE}/tasks/${id}`, { cache: 'no-store' })
  if (res.status === 404) notFound()
  if (!res.ok) throw new Error('Failed to load task')

  const { task, variables } = await res.json()

  const timesheet = variables.timesheetId
    ? await db.timesheet.findUnique({
        where: { id: variables.timesheetId as string },
        include: { employee: { include: { user: { select: { email: true } } } } },
      })
    : null

  const isOpen = task.status === 'open' || task.status === 'claimed'

  return (
    <Box sx={{ maxWidth: 640 }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton component={NextLink} href="/tasks" size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3">Review Task</Typography>
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
                This task has already been completed.
              </Alert>
            )}

            {isOpen && (
              <TaskDecisionForm taskId={id} managerId={session!.user.id} />
            )}
          </CardContent>
        </Card>

        {/* Timesheet card */}
        {timesheet && (
          <Card
            sx={{
              borderLeft: '3px solid',
              borderColor: 'primary.main',
            }}
          >
            <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
              <Typography variant="h5" sx={{ mb: 2.5 }}>Timesheet</Typography>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Stack spacing={2.5} divider={<Divider />}>
                    <DetailRow label="Employee">
                      <Typography variant="body2" fontWeight={500}>
                        {timesheet.employee.user.email}
                      </Typography>
                    </DetailRow>
                    <DetailRow label="Week Start">
                      <Typography variant="body2" fontWeight={500}>
                        {timesheet.weekStart.toISOString().split('T')[0]}
                      </Typography>
                    </DetailRow>
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Stack spacing={2.5} divider={<Divider />}>
                    <DetailRow label="Total Hours">
                      <Typography variant="body2" fontWeight={500}>
                        {timesheet.totalHours.toString()}h
                      </Typography>
                    </DetailRow>
                    <DetailRow label="Notes">
                      <Typography variant="body2" fontWeight={500}>
                        {timesheet.notes ?? '-'}
                      </Typography>
                    </DetailRow>
                  </Stack>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Box>
  )
}
