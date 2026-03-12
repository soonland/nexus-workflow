'use client'

import { useRouter } from 'next/navigation'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded'
import { useSnackbar } from '@/components/SnackbarContext'

interface OrgRow {
  id: string
  name: string
  legalName: string | null
  industry: string | null
  status: 'active' | 'inactive' | 'archived'
  owner: { id: string; fullName: string } | null
}

interface OrganizationsTableProps {
  organizations: OrgRow[]
  isManager: boolean
}

const StatusChip = ({ status }: { status: OrgRow['status'] }) => {
  const map = {
    active: { label: 'Active', color: 'success' as const },
    inactive: { label: 'Inactive', color: 'warning' as const },
    archived: { label: 'Archived', color: 'default' as const },
  }
  const { label, color } = map[status]
  return <Chip label={label} color={color} size="small" />
}

const OrganizationsTable = ({ organizations, isManager }: OrganizationsTableProps) => {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()

  async function handleArchive(org: OrgRow) {
    try {
      const res = await fetch(`/api/organizations/${org.id}/archive`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      showSnackbar({ message: `"${org.name}" archived.`, severity: 'success' })
      router.refresh()
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    }
  }

  return (
    <>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h2">Organizations</Typography>
        {isManager && (
          <Button
            component={NextLink}
            href="/organizations/new"
            variant="contained"
            startIcon={<AddRoundedIcon />}
          >
            Add Organization
          </Button>
        )}
      </Box>

      <Card>
        {organizations.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography color="text.secondary">No organizations yet. Create one to get started.</Typography>
          </Box>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Legal Name</TableCell>
                <TableCell>Industry</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Account Owner</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {organizations.map((org) => (
                <TableRow key={org.id} sx={{ '&:hover': { backgroundColor: 'action.hover' } }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{org.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {org.legalName ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {org.industry ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusChip status={org.status} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {org.owner?.fullName ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                      <IconButton
                        size="small"
                        component={NextLink}
                        href={`/organizations/${org.id}`}
                      >
                        <EditRoundedIcon fontSize="small" />
                      </IconButton>
                      {isManager && (
                        <IconButton
                          size="small"
                          color="warning"
                          onClick={() => handleArchive(org)}
                          title="Archive"
                        >
                          <ArchiveRoundedIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  )
}
export default OrganizationsTable
