import { auth } from '@/auth'
import { notFound, redirect } from 'next/navigation'
import { db } from '@/db/client'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import IconButton from '@mui/material/IconButton'
import Divider from '@mui/material/Divider'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import SubmitButton from './SubmitButton'

const STATUS_COLOR: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  submitted: 'warning',
  approved: 'success',
  rejected: 'error',
}

function formatDate(date: Date | null): string {
  if (!date) return '-'
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

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

export default async function TimesheetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const { id } = await params

  const ts = await db.timesheet.findUnique({
    where: { id },
    include: { employee: { include: { user: { select: { email: true } } } } },
  })
  if (!ts) notFound()

  if (
    session?.user.role !== 'manager' &&
    ts.employeeId !== session?.user.employeeId
  ) {
    redirect('/dashboard')
  }

  return (
    <Box sx={{ maxWidth: 560 }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton component={NextLink} href="/timesheets" size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3">Timesheet Detail</Typography>
      </Box>

      <Card>
        <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
          <Stack spacing={2.5} divider={<Divider />}>
            <DetailRow label="Employee">
              <Typography variant="body2" fontWeight={500}>
                {ts.employee.user.email}
              </Typography>
            </DetailRow>

            <DetailRow label="Week Start">
              <Typography variant="body2" fontWeight={500}>
                {ts.weekStart.toISOString().split('T')[0]}
              </Typography>
            </DetailRow>

            <DetailRow label="Total Hours">
              <Typography variant="body2" fontWeight={500}>
                {ts.totalHours.toString()}h
              </Typography>
            </DetailRow>

            <DetailRow label="Notes">
              <Typography variant="body2" fontWeight={500}>
                {ts.notes ?? '-'}
              </Typography>
            </DetailRow>

            <DetailRow label="Status">
              <Box>
                <Chip
                  label={ts.status}
                  size="small"
                  color={STATUS_COLOR[ts.status] ?? 'default'}
                />
              </Box>
            </DetailRow>

            <DetailRow label="Submitted">
              <Typography variant="body2" fontWeight={500}>
                {formatDate(ts.submittedAt)}
              </Typography>
            </DetailRow>

            <DetailRow label="Decided">
              <Typography variant="body2" fontWeight={500}>
                {formatDate(ts.decidedAt)}
              </Typography>
            </DetailRow>
          </Stack>

          {ts.status === 'draft' && ts.employeeId === session?.user.employeeId && (
            <Box sx={{ mt: 3 }}>
              <SubmitButton timesheetId={ts.id} />
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
