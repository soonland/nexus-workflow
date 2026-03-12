import React from 'react'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import type { Employee, EmployeeProfileUpdateRequest, User } from '@prisma/client'

type Request = EmployeeProfileUpdateRequest & {
  employee: Employee & { user: Pick<User, 'email'> }
}

const CONTACT_FIELDS: { label: string; key: keyof Employee & keyof EmployeeProfileUpdateRequest }[] = [
  { label: 'Phone',       key: 'phone' },
  { label: 'Street',      key: 'street' },
  { label: 'City',        key: 'city' },
  { label: 'State',       key: 'state' },
  { label: 'Postal Code', key: 'postalCode' },
  { label: 'Country',     key: 'country' },
]

const ProfileUpdateCard = ({ request }: { request: Request }) => {
  const emp = request.employee
  const rows = CONTACT_FIELDS
    .map((f) => ({
      label:    f.label,
      current:  (emp[f.key] as string | null) ?? null,
      proposed: (request[f.key] as string | null) ?? null,
    }))
    .filter((r) => r.proposed !== null)

  const borderColor = 'divider'
  const cellSx = { px: 2, py: 1.5, borderTop: '1px solid', borderColor }

  return (
    <Card sx={{ borderLeft: '3px solid', borderColor: 'primary.main' }}>
      <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
        <Typography variant="h5" sx={{ mb: 0.5 }}>Proposed Contact Changes</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          {emp.fullName} &middot; {emp.user.email}
        </Typography>

        <Grid
          container
          sx={{ border: '1px solid', borderColor, borderRadius: 1, overflow: 'hidden' }}
        >
          {/* Header */}
          {(['Field', 'Current', 'Proposed'] as const).map((h, i) => (
            <Grid
              key={h}
              size={4}
              sx={{
                px: 2, py: 1,
                bgcolor: 'action.hover',
                ...(i > 0 && { borderLeft: '1px solid', borderColor }),
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {h}
              </Typography>
            </Grid>
          ))}

          {/* Data rows */}
          {rows.map((r) => (
            <React.Fragment key={r.label}>
              <Grid size={4} sx={cellSx}>
                <Typography variant="body2" color="text.secondary">{r.label}</Typography>
              </Grid>
              <Grid size={4} sx={{ ...cellSx, borderLeft: '1px solid', borderColor }}>
                <Typography variant="body2" color={r.current ? 'text.primary' : 'text.disabled'}>
                  {r.current ?? '—'}
                </Typography>
              </Grid>
              <Grid size={4} sx={{ ...cellSx, borderLeft: '1px solid', borderColor, bgcolor: 'success.50' }}>
                <Typography variant="body2" fontWeight={500} color="success.dark">
                  {r.proposed}
                </Typography>
              </Grid>
            </React.Fragment>
          ))}
        </Grid>
      </CardContent>
    </Card>
  )
}
export default ProfileUpdateCard
