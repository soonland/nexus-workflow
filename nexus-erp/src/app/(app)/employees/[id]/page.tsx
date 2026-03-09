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
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import EmployeeEditForm from '@/components/EmployeeEditForm'
import EmployeeContactForm from '@/components/EmployeeContactForm'

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </Typography>
      {typeof value === 'string' ? (
        <Typography variant="body2" fontWeight={500}>{value || '—'}</Typography>
      ) : (
        value
      )}
    </Box>
  )
}

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect('/login')

  const { id } = await params
  const isManager = session.user.role === 'manager'

  if (!isManager && session.user.employeeId !== id) redirect('/dashboard')

  const emp = await db.employee.findUnique({
    where: { id },
    include: {
      user: { select: { email: true, role: true } },
      manager: { select: { id: true, fullName: true } },
      department: { select: { name: true } },
    },
  })
  if (!emp) notFound()

  const [allEmployees, departments, pendingRequest] = await Promise.all([
    isManager
      ? db.employee.findMany({
          where: { id: { not: id } },
          select: { id: true, fullName: true },
          orderBy: { fullName: 'asc' },
        })
      : Promise.resolve([]),
    isManager
      ? db.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
      : Promise.resolve([]),
    db.employeeProfileUpdateRequest.findFirst({
      where: { employeeId: id, status: 'PENDING' },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const hireDate = new Date(emp.hireDate).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const hireDateISO = emp.hireDate.toISOString().split('T')[0]

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton component={NextLink} href={isManager ? '/employees' : '/dashboard'} size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3">{emp.fullName}</Typography>
        {!isManager && (
          <Chip label="Your Profile" size="small" color="primary" variant="outlined" />
        )}
      </Box>

      <Card sx={{ maxWidth: 720 }}>
        <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
          {/* Avatar + name header */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Avatar sx={{ width: 56, height: 56, fontSize: '1.25rem', fontWeight: 600, bgcolor: 'primary.light', color: 'primary.dark' }}>
              {getInitials(emp.fullName)}
            </Avatar>
            <Box>
              <Typography variant="h5">{emp.fullName}</Typography>
              <Typography variant="body2" color="text.secondary">{emp.user.email}</Typography>
            </Box>
          </Box>

          {isManager ? (
            <EmployeeEditForm
              employeeId={id}
              defaultValues={{
                fullName: emp.fullName,
                departmentId: emp.departmentId,
                hireDate: hireDateISO,
                managerId: emp.managerId,
                role: emp.user.role as 'employee' | 'manager',
                phone: emp.phone,
                street: emp.street,
                city: emp.city,
                state: emp.state,
                postalCode: emp.postalCode,
                country: emp.country,
              }}
              managers={allEmployees}
              departments={departments}
            />
          ) : (
            <Stack spacing={3} divider={<Divider />}>
              {/* Employment — read-only */}
              <Box>
                <Typography variant="overline" color="text.secondary">Employment</Typography>
                <Grid container spacing={2} sx={{ mt: 0.5 }}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <DetailRow label="Department" value={emp.department ? <Chip label={emp.department.name} size="small" variant="outlined" /> : '—'} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <DetailRow label="Hire Date" value={hireDate} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <DetailRow label="Role" value={
                      <Chip label={emp.user.role} size="small" color={emp.user.role === 'manager' ? 'primary' : 'default'} />
                    } />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <DetailRow label="Manager" value={emp.manager?.fullName ?? '—'} />
                  </Grid>
                </Grid>
              </Box>

              {/* Contact + Address — editable */}
              <Box>
                <Typography variant="overline" color="text.secondary">Contact & Address</Typography>
                <Box sx={{ mt: 1.5 }}>
                  <EmployeeContactForm
                    employeeId={id}
                    defaultValues={{
                      phone: emp.phone,
                      street: emp.street,
                      city: emp.city,
                      state: emp.state,
                      postalCode: emp.postalCode,
                      country: emp.country,
                    }}
                    pendingRequest={pendingRequest
                      ? { id: pendingRequest.id, createdAt: pendingRequest.createdAt.toISOString() }
                      : null
                    }
                  />
                </Box>
              </Box>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
