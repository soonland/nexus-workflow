import { redirect, notFound } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Paper from '@mui/material/Paper'
import Chip from '@mui/material/Chip'
import Avatar from '@mui/material/Avatar'
import Stack from '@mui/material/Stack'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded'
import CorporateFareRoundedIcon from '@mui/icons-material/CorporateFareRounded'
import CalendarTodayRoundedIcon from '@mui/icons-material/CalendarTodayRounded'
import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import Button from '@mui/material/Button'
import MailRoundedIcon from '@mui/icons-material/MailRounded'
import { getTranslations, getLocale } from 'next-intl/server'
import { db } from '@/db/client'
import { auth } from '@/auth'
import EmployeeEditForm from '@/components/EmployeeEditForm'
import EmployeeContactForm from '@/components/EmployeeContactForm'
import LanguageSelector from '@/app/[locale]/(app)/settings/LanguageSelector'
import AuditLogPanel from '@/components/AuditLogPanel'

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

const ReadOnlyField = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) => {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
      <Box
        sx={{
          mt: 0.25,
          color: 'text.disabled',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', mb: 0.25 }}
        >
          {label}
        </Typography>
        {typeof value === 'string' ? (
          <Typography variant="body2" fontWeight={500}>
            {value || '—'}
          </Typography>
        ) : (
          value
        )}
      </Box>
    </Box>
  )
}

const EmployeeProfilePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const session = await auth()
  if (!session) redirect('/login')

  const { id } = await params
  const isManager = session.user.role === 'manager'

  if (!isManager && session.user.employeeId !== id) redirect('/dashboard')

  const [t, tMessages, locale] = await Promise.all([
    getTranslations('employees'),
    getTranslations('messages'),
    getLocale(),
  ])

  const emp = await db.employee.findUnique({
    where: { id },
    include: {
      user: { select: { email: true, role: true } },
      manager: { select: { id: true, fullName: true } },
      department: { select: { id: true, name: true, permissions: { select: { permissionKey: true } } } },
    },
  })
  if (!emp) notFound()

  const [allEmployees, departments, pendingRequest, allPermissions, empUserPermissions, userGroups, allGroups] =
    await Promise.all([
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
        select: {
          id: true,
          createdAt: true,
          phone: true,
          street: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      isManager ? db.permission.findMany({ orderBy: { key: 'asc' } }) : Promise.resolve([]),
      isManager
        ? db.userPermission.findMany({ where: { userId: emp.userId }, select: { permissionKey: true } })
        : Promise.resolve([]),
      isManager
        ? db.groupMembership.findMany({
            where: { userId: emp.userId },
            include: {
              group: {
                select: {
                  id: true,
                  name: true,
                  permissions: { select: { permissionKey: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      isManager
        ? db.group.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ])

  const groupPermissions = userGroups.flatMap((m) =>
    m.group.permissions.map((p) => ({
      groupId: m.group.id,
      groupName: m.group.name,
      permissionKey: p.permissionKey,
    }))
  )

  const deptPermissions = (isManager && emp.department)
    ? emp.department.permissions.map((p) => ({
        deptId: emp.department?.id ?? '',
        deptName: emp.department?.name ?? '',
        permissionKey: p.permissionKey,
      }))
    : []

  const hireDate = new Date(emp.hireDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const hireDateISO = emp.hireDate.toISOString().split('T')[0]

  // Derive avatar color from name for visual variety
  const avatarHues = ['#4F46E5', '#0891B2', '#059669', '#D97706', '#DC2626', '#7C3AED']
  const avatarBg = avatarHues[emp.fullName.charCodeAt(0) % avatarHues.length]

  return (
    <Box sx={{ maxWidth: 900 }}>
      {/* ── Page breadcrumb / back nav ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <IconButton
         
          href={isManager ? '/employees' : '/dashboard'}
          size="small"
          sx={{ color: 'text.secondary' }}
        >
          <ArrowBackRoundedIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" color="text.secondary">
          {isManager ? t('breadcrumb.employees') : t('breadcrumb.dashboard')}
        </Typography>
      </Box>

      {/* ── Identity hero ── */}
      <Paper
        variant="outlined"
        sx={{ p: 3, mb: 3, borderRadius: 2 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap' }}>
          <Avatar
            sx={{
              width: 72,
              height: 72,
              fontSize: '1.5rem',
              fontWeight: 700,
              bgcolor: avatarBg,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {getInitials(emp.fullName)}
          </Avatar>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
              <Typography variant="h5" fontWeight={700} noWrap>
                {emp.fullName}
              </Typography>
              <Chip
                label={emp.user.role === 'manager' ? 'Manager' : 'Employee'}
                size="small"
                color={emp.user.role === 'manager' ? 'primary' : 'default'}
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />
              {!isManager && (
                <Chip label={t('yourProfile')} size="small" color="secondary" variant="outlined" />
              )}
            </Box>
            <Typography variant="body2" color="text.secondary">
              {emp.user.email}
            </Typography>
          </Box>

          {/* Quick-glance metadata — visible at a glance without opening any tab */}
          <Stack
            direction="row"
            spacing={3}
            divider={<Divider orientation="vertical" flexItem />}
            sx={{ display: { xs: 'none', md: 'flex' }, flexShrink: 0 }}
          >
            <ReadOnlyField
              icon={<CorporateFareRoundedIcon sx={{ fontSize: 16 }} />}
              label={t('fields.department')}
              value={
                emp.department ? (
                  <Chip label={emp.department.name} size="small" variant="outlined" />
                ) : (
                  '—'
                )
              }
            />
            <ReadOnlyField
              icon={<CalendarTodayRoundedIcon sx={{ fontSize: 16 }} />}
              label={t('fields.hireDate')}
              value={hireDate}
            />
            <ReadOnlyField
              icon={<PersonRoundedIcon sx={{ fontSize: 16 }} />}
              label={t('fields.manager')}
              value={emp.manager?.fullName ?? '—'}
            />
          </Stack>

          {/* Send Message — shown when viewing another user's profile */}
          {emp.userId !== session.user.id && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<MailRoundedIcon />}
              href={`/messages?recipientId=${emp.userId}`}
              sx={{ flexShrink: 0 }}
            >
              {tMessages('sendMessageToEmployee')}
            </Button>
          )}
        </Box>
      </Paper>

      {/* ── Edit form (manager) or read-only view (employee) ── */}
      {isManager ? (
        <EmployeeEditForm
          employeeId={id}
          userId={emp.userId}
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
          allPermissions={allPermissions}
          userPermissions={empUserPermissions.map((p) => p.permissionKey)}
          groupPermissions={groupPermissions}
          deptPermissions={deptPermissions}
          allGroups={allGroups.map((g) => ({ groupId: g.id, groupName: g.name }))}
          userGroups={userGroups.map((m) => ({ groupId: m.group.id, groupName: m.group.name }))}
        />
      ) : (
        /* ── Read-only employee self-view ── */
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Stack divider={<Divider />}>
            {/* Employment — read-only */}
            <Box sx={{ p: 3 }}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: 'block', mb: 2 }}
              >
                {t('sections.employment')}
              </Typography>
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <ReadOnlyField
                    icon={<CorporateFareRoundedIcon sx={{ fontSize: 16 }} />}
                    label={t('fields.department')}
                    value={
                      emp.department ? (
                        <Chip label={emp.department.name} size="small" variant="outlined" />
                      ) : (
                        '—'
                      )
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <ReadOnlyField
                    icon={<CalendarTodayRoundedIcon sx={{ fontSize: 16 }} />}
                    label={t('fields.hireDate')}
                    value={hireDate}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <ReadOnlyField
                    icon={<BadgeRoundedIcon sx={{ fontSize: 16 }} />}
                    label={t('fields.role')}
                    value={
                      <Chip
                        label={emp.user.role}
                        size="small"
                        color={emp.user.role === 'manager' ? 'primary' : 'default'}
                      />
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <ReadOnlyField
                    icon={<PersonRoundedIcon sx={{ fontSize: 16 }} />}
                    label={t('fields.manager')}
                    value={emp.manager?.fullName ?? '—'}
                  />
                </Grid>
              </Grid>
            </Box>

            {/* Contact & Address — editable via workflow */}
            <Box sx={{ p: 3 }}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: 'block', mb: 2 }}
              >
                {t('sections.contactAddress')}
              </Typography>
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
                pendingRequest={
                  pendingRequest
                    ? {
                        id: pendingRequest.id,
                        createdAt: pendingRequest.createdAt.toISOString(),
                        phone: pendingRequest.phone,
                        street: pendingRequest.street,
                        city: pendingRequest.city,
                        state: pendingRequest.state,
                        postalCode: pendingRequest.postalCode,
                        country: pendingRequest.country,
                      }
                    : null
                }
              />
            </Box>

            {/* Preferences */}
            <Box sx={{ p: 3 }}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: 'block', mb: 2 }}
              >
                {t('sections.preferences')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {t('preferences.language')}
              </Typography>
              <LanguageSelector userId={session.user.id} currentLocale={locale} />
            </Box>
          </Stack>
        </Paper>
      )}
      {isManager && <AuditLogPanel entityType="Employee" entityId={id} />}
    </Box>
  )
}
export default EmployeeProfilePage
