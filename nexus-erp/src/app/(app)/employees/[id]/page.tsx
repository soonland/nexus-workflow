import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db/client'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Avatar from '@mui/material/Avatar'
import Stack from '@mui/material/Stack'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Grid from '@mui/material/Grid'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'

const STATUS_COLOR: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  submitted: 'warning',
  approved: 'success',
  rejected: 'error',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
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

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const { id } = await params
  const emp = await db.employee.findUnique({
    where: { id },
    include: {
      user: { select: { email: true, role: true } },
      manager: { select: { fullName: true } },
      timesheets: { orderBy: { weekStart: 'desc' }, take: 10 },
    },
  })
  if (!emp) notFound()

  const hireDate = new Date(emp.hireDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <Box>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton component={NextLink} href="/employees" size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3">{emp.fullName}</Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Left — Profile card */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
              {/* Avatar + name header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Avatar
                  sx={{
                    width: 56,
                    height: 56,
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    bgcolor: 'primary.light',
                    color: 'primary.dark',
                  }}
                >
                  {getInitials(emp.fullName)}
                </Avatar>
                <Box>
                  <Typography variant="h5">{emp.fullName}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {emp.user.email}
                  </Typography>
                </Box>
              </Box>

              <Stack spacing={2.5} divider={<Divider />}>
                <DetailRow label="Department">
                  <Box>
                    <Chip label={emp.department} size="small" variant="outlined" />
                  </Box>
                </DetailRow>

                <DetailRow label="Hire Date">
                  <Typography variant="body2" fontWeight={500}>{hireDate}</Typography>
                </DetailRow>

                <DetailRow label="Role">
                  <Box>
                    <Chip
                      label={emp.user.role}
                      size="small"
                      color={emp.user.role === 'manager' ? 'primary' : 'default'}
                    />
                  </Box>
                </DetailRow>

                <DetailRow label="Manager">
                  <Typography variant="body2" fontWeight={500}>
                    {emp.manager?.fullName ?? 'None'}
                  </Typography>
                </DetailRow>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Right — Recent timesheets card */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
              <Typography variant="h5" sx={{ mb: 2 }}>Recent Timesheets</Typography>

              {emp.timesheets.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No timesheets yet.
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Week Start</TableCell>
                      <TableCell>Hours</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {emp.timesheets.map((ts) => (
                      <TableRow
                        key={ts.id}
                        sx={{ '&:hover': { backgroundColor: 'action.hover' } }}
                      >
                        <TableCell>
                          <Typography variant="body2">
                            {ts.weekStart.toISOString().split('T')[0]}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{ts.totalHours.toString()}h</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={ts.status}
                            size="small"
                            color={STATUS_COLOR[ts.status] ?? 'default'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
