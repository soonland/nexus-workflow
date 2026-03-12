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
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import { useSnackbar } from '@/components/SnackbarContext'

interface Group {
  id: string
  name: string
  description: string | null
  type: 'security' | 'default'
  _count: { permissions: number; members: number }
}

interface GroupsTableProps {
  groups: Group[]
}

export default function GroupsTable({ groups }: GroupsTableProps) {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()

  async function handleDelete(group: Group) {
    if (!window.confirm(`Delete group "${group.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/groups/${group.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      showSnackbar({ message: `Group "${group.name}" deleted.`, severity: 'success' })
      router.refresh()
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    }
  }

  return (
    <>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h2">Groups</Typography>
        <Button
          component={NextLink}
          href="/groups/new"
          variant="contained"
          startIcon={<AddRoundedIcon />}
        >
          New Group
        </Button>
      </Box>

      <Card>
        {groups.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography color="text.secondary">No groups yet. Create one to get started.</Typography>
          </Box>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Permissions</TableCell>
                <TableCell>Members</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id} sx={{ '&:hover': { backgroundColor: 'action.hover' } }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight={500}>{group.name}</Typography>
                      {group.type === 'default' && (
                        <Chip label="Default" size="small" color="primary" variant="outlined" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 600 }} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {group.description || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={group._count.permissions} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    {group.type === 'default'
                      ? <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>All users</Typography>
                      : <Chip label={group._count.members} size="small" variant="outlined" />}
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                      <IconButton
                        size="small"
                        component={NextLink}
                        href={`/groups/${group.id}`}
                      >
                        <EditRoundedIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDelete(group)}>
                        <DeleteRoundedIcon fontSize="small" />
                      </IconButton>
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
