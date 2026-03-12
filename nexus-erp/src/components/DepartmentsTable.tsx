'use client'

import { useState } from 'react'
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
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import { useSnackbar } from '@/components/SnackbarContext'

interface Department {
  id: string
  name: string
  createdAt: string
  _count: { employees: number }
}

interface DepartmentsTableProps {
  departments: Department[]
}

const DepartmentsTable = ({ departments }: DepartmentsTableProps) => {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  function openDelete(dept: Department) {
    setDeleteTarget(dept)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/departments/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setDeleteTarget(null)
      router.refresh()
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <>
      {/* Page header */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h2">Departments</Typography>
        <Button
          component={NextLink}
          href="/departments/new"
          variant="contained"
          startIcon={<AddRoundedIcon />}
        >
          Add Department
        </Button>
      </Box>

      <Card>
        {departments.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography color="text.secondary">No departments yet. Create one to get started.</Typography>
          </Box>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Employees</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {departments.map((dept) => (
                <TableRow key={dept.id} sx={{ '&:hover': { backgroundColor: 'action.hover' } }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{dept.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {dept._count.employees}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(dept.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                      <IconButton
                        size="small"
                        component={NextLink}
                        href={`/departments/${dept.id}`}
                      >
                        <EditRoundedIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => openDelete(dept)}>
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

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Department</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={deleteLoading}
          >
            {deleteLoading ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
export default DepartmentsTable
