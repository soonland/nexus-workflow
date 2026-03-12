'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Autocomplete from '@mui/material/Autocomplete'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import { useSnackbar } from '@/components/SnackbarContext'
import PermissionMatrix from '@/components/PermissionMatrix'

interface Employee {
  id: string
  fullName: string
  departmentId: string | null
  departmentName: string | null
}

interface DepartmentFormProps {
  mode: 'create' | 'edit'
  departmentId?: string
  defaultName?: string
  defaultMembers?: Pick<Employee, 'id' | 'fullName'>[]
  defaultPermissions?: string[]
  allEmployees: Employee[]
  allPermissions?: Array<{ key: string; label: string; type: string }>
}

type Status = 'idle' | 'saving'

export default function DepartmentForm({
  mode,
  departmentId,
  defaultName = '',
  defaultMembers = [],
  defaultPermissions = [],
  allEmployees,
  allPermissions = [],
}: DepartmentFormProps) {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const [name, setName] = useState(defaultName)
  const [members, setMembers] = useState<Employee[]>(
    defaultMembers.map(
      (m) => allEmployees.find((e) => e.id === m.id) ?? { ...m, departmentId: null, departmentName: null }
    )
  )
  const [status, setStatus] = useState<Status>('idle')
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set(defaultPermissions))
  const [savingPerms, setSavingPerms] = useState(false)

  function handlePermToggle(key: string, checked: boolean) {
    setSelectedPerms((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function handleSubmit() {
    if (!name.trim()) return
    setStatus('saving')
    try {
      const payload = { name: name.trim(), memberIds: members.map((m) => m.id) }
      const res =
        mode === 'create'
          ? await fetch('/api/departments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/departments/${departmentId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }

      if (mode === 'create') {
        const dept = await res.json()
        router.push(`/departments/${dept.id}`)
      } else {
        showSnackbar({ message: 'Changes saved.', severity: 'success' })
        router.refresh()
      }
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    } finally {
      setStatus('idle')
    }
  }

  async function handleSavePermissions() {
    if (!departmentId) return
    setSavingPerms(true)
    try {
      const res = await fetch(`/api/departments/${departmentId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionKeys: Array.from(selectedPerms) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      showSnackbar({ message: 'Permissions saved.', severity: 'success' })
      router.refresh()
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    } finally {
      setSavingPerms(false)
    }
  }

  const currentDeptMemberIds = new Set(defaultMembers.map((m) => m.id))

  function getOptionLabel(emp: Employee): string {
    if (emp.departmentId && !currentDeptMemberIds.has(emp.id) && emp.departmentName) {
      return `${emp.fullName} (${emp.departmentName})`
    }
    return emp.fullName
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton component={NextLink} href="/departments" size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3">
          {mode === 'create' ? 'New Department' : defaultName}
        </Typography>
      </Box>

      <Card sx={{ maxWidth: 720 }}>
        <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
          <Stack spacing={3} divider={<Divider />}>
            {/* Name section */}
            <Box>
              <Typography variant="overline" color="text.secondary">Details</Typography>
              <Box sx={{ mt: 1.5 }}>
                <TextField
                  label="Department Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  fullWidth
                  size="small"
                  autoFocus={mode === 'create'}
                />
              </Box>
            </Box>

            {/* Members section */}
            <Box>
              <Typography variant="overline" color="text.secondary">Members</Typography>
              <Box sx={{ mt: 1.5 }}>
                <Autocomplete
                  multiple
                  options={allEmployees}
                  value={members}
                  onChange={(_, newValue) => setMembers(newValue)}
                  getOptionLabel={getOptionLabel}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        label={option.fullName}
                        size="small"
                        {...getTagProps({ index })}
                        key={option.id}
                      />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Members"
                      size="small"
                      placeholder={members.length === 0 ? 'Search employees…' : undefined}
                      helperText="Assigning an employee here will move them from their current department."
                    />
                  )}
                  noOptionsText="No employees found"
                />
              </Box>
            </Box>

            {/* Permissions section — only in edit mode */}
            {mode === 'edit' && (
              <Box>
                <PermissionMatrix
                  allPermissions={allPermissions}
                  grantedKeys={selectedPerms}
                  onToggle={handlePermToggle}
                />
                <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleSavePermissions}
                    disabled={savingPerms}
                  >
                    {savingPerms ? 'Saving…' : 'Save Permissions'}
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    Permissions granted to all members of this department
                  </Typography>
                </Box>
              </Box>
            )}

            {/* Actions */}
            <Box>
              <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                <Button component={NextLink} href="/departments" variant="text">
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={handleSubmit}
                  disabled={!name.trim() || status === 'saving'}
                >
                  {status === 'saving'
                    ? (mode === 'create' ? 'Creating…' : 'Saving…')
                    : (mode === 'create' ? 'Create Department' : 'Save Changes')}
                </Button>
              </Stack>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
