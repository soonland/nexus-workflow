'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'

interface Department {
  id: string
  name: string
  createdAt: string
  _count: { employees: number }
}

interface DepartmentsTableProps {
  departments: Department[]
}

export default function DepartmentsTable({ departments }: DepartmentsTableProps) {
  const router = useRouter()

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState('')
  const [createSaving, setCreateSaving] = useState(false)

  // Edit dialog
  const [editTarget, setEditTarget] = useState<Department | null>(null)
  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  function openCreate() {
    setCreateName('')
    setCreateError('')
    setCreateOpen(true)
  }

  function openEdit(dept: Department) {
    setEditTarget(dept)
    setEditName(dept.name)
    setEditError('')
  }

  function openDelete(dept: Department) {
    setDeleteTarget(dept)
    setDeleteError('')
  }

  async function handleCreate() {
    setCreateSaving(true)
    setCreateError('')
    try {
      const res = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createName.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setCreateOpen(false)
      router.refresh()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setCreateSaving(false)
    }
  }

  async function handleEdit() {
    if (!editTarget) return
    setEditSaving(true)
    setEditError('')
    try {
      const res = await fetch(`/api/departments/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setEditTarget(null)
      router.refresh()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/departments/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setDeleteTarget(null)
      router.refresh()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <>
      {/* Page header */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h2">Departments</Typography>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openCreate}>
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
                      <IconButton size="small" onClick={() => openEdit(dept)}>
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

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Department</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
          <TextField
            label="Name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && createName.trim()) handleCreate() }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!createName.trim() || createSaving}
          >
            {createSaving ? 'Creating…' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename Department</DialogTitle>
        <DialogContent>
          {editError && <Alert severity="error" sx={{ mb: 2 }}>{editError}</Alert>}
          <TextField
            label="Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && editName.trim()) handleEdit() }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleEdit}
            disabled={!editName.trim() || editSaving}
          >
            {editSaving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Department</DialogTitle>
        <DialogContent>
          {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert>}
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
