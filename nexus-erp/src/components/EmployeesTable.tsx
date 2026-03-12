'use client'

import { useState } from 'react'
import NextLink from 'next/link'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'

// ── Types ──────────────────────────────────────────────────────────────────────

interface EmployeeRow {
  id: string
  fullName: string
  hireDate: Date
  user: { email: string; role: string }
  department: { name: string } | null
}

interface EmployeeSummary {
  id: string
  fullName: string
  hireDate: string
  phone: string | null
  street: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  department: { id: string; name: string } | null
  manager: { id: string; fullName: string } | null
  user: { email: string; role: string }
  groups: { id: string; name: string }[]
  effectivePermissions: {
    key: string
    label: string
    direct: boolean
    groups: { id: string; name: string }[]
  }[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>
        {label}
      </Typography>
      {typeof value === 'string'
        ? <Typography variant="body2" fontWeight={500}>{value || '—'}</Typography>
        : value}
    </Box>
  )
}

// ── Dialog content ─────────────────────────────────────────────────────────────

const ProfileDialogContent = ({ employeeId }: { employeeId: string }) => {
  const [data, setData] = useState<EmployeeSummary | null>(null)
  const [error, setError] = useState('')

  // Fetch on first render
  useState(() => {
    fetch(`/api/employees/${employeeId}`)
      .then((r) => r.ok ? r.json() : r.json().then((d: { error?: string }) => Promise.reject(d.error ?? 'Failed to load')))
      .then(setData)
      .catch((e: unknown) => setError(typeof e === 'string' ? e : 'Failed to load'))
  })

  if (error) {
    return <Typography color="error" sx={{ p: 2 }}>{error}</Typography>
  }

  if (!data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    )
  }

  const address = [data.street, data.city, data.state, data.postalCode, data.country].filter(Boolean).join(', ')

  return (
    <Stack spacing={3}>
      {/* Identity */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Avatar sx={{ width: 56, height: 56, fontSize: '1.25rem', fontWeight: 600, bgcolor: 'primary.light', color: 'primary.dark' }}>
          {getInitials(data.fullName)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" fontWeight={700}>{data.fullName}</Typography>
          <Typography variant="body2" color="text.secondary">{data.user.email}</Typography>
        </Box>
        <Chip label={data.user.role} size="small" color={data.user.role === 'manager' ? 'primary' : 'default'} />
      </Box>

      <Divider />

      {/* Employment */}
      <Box>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>Employment</Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 6 }}>
            <DetailRow label="Department" value={
              data.department
                ? <Chip label={data.department.name} size="small" variant="outlined" />
                : <Typography variant="body2" fontWeight={500}>—</Typography>
            } />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <DetailRow label="Hire Date" value={formatDate(data.hireDate)} />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <DetailRow label="Manager" value={data.manager?.fullName ?? '—'} />
          </Grid>
          {data.phone && (
            <Grid size={{ xs: 6 }}>
              <DetailRow label="Phone" value={data.phone} />
            </Grid>
          )}
          {address && (
            <Grid size={{ xs: 12 }}>
              <DetailRow label="Address" value={address} />
            </Grid>
          )}
        </Grid>
      </Box>

      <Divider />

      {/* Groups */}
      <Box>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 1, display: 'block' }}>Groups</Typography>
        {data.groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Not a member of any group.</Typography>
        ) : (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {data.groups.map((g) => (
              <Chip key={g.id} label={g.name} size="small" component={NextLink} href={`/groups/${g.id}`} clickable />
            ))}
          </Stack>
        )}
      </Box>

      <Divider />

      {/* Effective permissions */}
      <Box>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 1, display: 'block' }}>Effective Permissions</Typography>
        {data.effectivePermissions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No permissions granted.</Typography>
        ) : (
          <Stack spacing={1}>
            {data.effectivePermissions.map((p) => (
              <Box key={p.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" fontWeight={500} sx={{ flex: 1, minWidth: 0 }}>
                  {p.label || p.key}
                </Typography>
                {p.direct && (
                  <Chip label="Direct" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                )}
                {p.groups.map((g) => (
                  <Chip
                    key={g.id}
                    label={`via ${g.name}`}
                    size="small"
                    color="info"
                    variant="outlined"
                    component={NextLink}
                    href={`/groups/${g.id}`}
                    clickable
                    sx={{ height: 20, fontSize: '0.65rem' }}
                  />
                ))}
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

const EmployeesTable = ({ employees }: { employees: EmployeeRow[] }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = employees.find((e) => e.id === selectedId)

  return (
    <>
      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Department</TableCell>
              <TableCell>Hire Date</TableCell>
              <TableCell>Role</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {employees.map((emp) => (
              <TableRow key={emp.id} sx={{ '&:hover': { backgroundColor: 'action.hover' } }}>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Avatar sx={{ width: 32, height: 32, fontSize: '0.75rem', bgcolor: 'primary.light', color: 'primary.dark' }}>
                      {getInitials(emp.fullName)}
                    </Avatar>
                    <Typography variant="body2" fontWeight={500}>{emp.fullName}</Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">{emp.user.email}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">{emp.department?.name ?? '—'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {emp.hireDate.toISOString().split('T')[0]}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={emp.user.role} size="small" color={emp.user.role === 'manager' ? 'primary' : 'default'} />
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Button size="small" variant="text" onClick={() => setSelectedId(emp.id)}>
                      Preview
                    </Button>
                    <Button component={NextLink} href={`/employees/${emp.id}`} size="small" variant="text">
                      Edit
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Typography variant="h6">Employee Profile</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            {selected && (
              <Tooltip title="Open full profile">
                <IconButton size="small" component={NextLink} href={`/employees/${selected.id}`}>
                  <OpenInNewRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <IconButton size="small" onClick={() => setSelectedId(null)}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {selectedId && <ProfileDialogContent key={selectedId} employeeId={selectedId} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
export default EmployeesTable
