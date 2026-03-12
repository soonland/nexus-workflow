'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import NextLink from 'next/link'
import { useSnackbar } from '@/components/SnackbarContext'
import PermissionMatrix, { type InheritedSource } from '@/components/PermissionMatrix'

// ── Types ────────────────────────────────────────────────────────────────────

interface ManagerOption {
  id: string
  fullName: string
}

interface DepartmentOption {
  id: string
  name: string
}

interface PermissionOption {
  key: string
  label: string
  type: string
}

interface GroupOption {
  groupId: string
  groupName: string
}

interface GroupPermission {
  groupId: string
  groupName: string
  permissionKey: string
}

interface DeptPermission {
  deptId: string
  deptName: string
  permissionKey: string
}

interface EmployeeEditFormProps {
  employeeId: string
  userId: string
  defaultValues: {
    fullName: string
    departmentId: string | null
    hireDate: string
    managerId: string | null
    role: 'employee' | 'manager'
    phone: string | null
    street: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    country: string | null
  }
  managers: ManagerOption[]
  departments: DepartmentOption[]
  allPermissions: PermissionOption[]
  userPermissions: string[]
  groupPermissions?: GroupPermission[]
  deptPermissions?: DeptPermission[]
  allGroups?: GroupOption[]
  userGroups?: GroupOption[]
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ display: 'block', mb: 2, letterSpacing: '0.08em' }}
    >
      {children}
    </Typography>
  )
}

// ── Tab panel wrapper ─────────────────────────────────────────────────────────

function TabPanel({
  value,
  index,
  children,
}: {
  value: number
  index: number
  children: React.ReactNode
}) {
  return (
    <Box
      role="tabpanel"
      hidden={value !== index}
      id={`employee-tabpanel-${index}`}
      aria-labelledby={`employee-tab-${index}`}
    >
      {value === index && children}
    </Box>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EmployeeEditForm({
  employeeId,
  userId,
  defaultValues,
  managers,
  departments,
  allPermissions,
  userPermissions,
  groupPermissions = [],
  deptPermissions = [],
  allGroups = [],
  userGroups = [],
}: EmployeeEditFormProps) {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()

  const [tab, setTab] = useState(0)
  const [form, setForm] = useState(defaultValues)
  const [saving, setSaving] = useState(false)

  const [grantedPerms, setGrantedPerms] = useState<Set<string>>(new Set(userPermissions))
  const [savingPerms, setSavingPerms] = useState(false)

  const [selectedGroups, setSelectedGroups] = useState<GroupOption[]>(userGroups)
  const [savingGroups, setSavingGroups] = useState(false)

  function setField(field: keyof typeof form, value: string | null) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Build inheritedSources map from group + dept permissions
  const inheritedSources: Record<string, InheritedSource[]> = {}
  for (const gp of groupPermissions) {
    inheritedSources[gp.permissionKey] ??= []
    inheritedSources[gp.permissionKey].push({
      id: gp.groupId,
      label: gp.groupName,
      type: 'group',
      href: `/groups/${gp.groupId}`,
    })
  }
  for (const dp of deptPermissions) {
    inheritedSources[dp.permissionKey] ??= []
    inheritedSources[dp.permissionKey].push({
      id: dp.deptId,
      label: dp.deptName,
      type: 'department',
      href: `/departments/${dp.deptId}`,
    })
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleSaveProfile() {
    setSaving(true)
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      showSnackbar({ message: 'Profile saved.', severity: 'success' })
      router.refresh()
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  function handlePermissionToggle(key: string, checked: boolean) {
    setGrantedPerms((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function handleSavePermissions() {
    setSavingPerms(true)
    try {
      const res = await fetch(`/api/users/${userId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionKeys: Array.from(grantedPerms) }),
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

  async function handleSaveGroups() {
    setSavingGroups(true)
    try {
      const res = await fetch(`/api/users/${userId}/groups`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: selectedGroups.map((g) => g.groupId) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      showSnackbar({ message: 'Groups saved.', severity: 'success' })
      router.refresh()
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    } finally {
      setSavingGroups(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {/* Tab bar */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, pt: 0.5 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            aria-label="Employee edit sections"
            sx={{
              '& .MuiTab-root': { minHeight: 48, fontSize: '0.875rem', fontWeight: 500 },
            }}
          >
            <Tab label="Profile" id="employee-tab-0" aria-controls="employee-tabpanel-0" />
            <Tab label="Contact" id="employee-tab-1" aria-controls="employee-tabpanel-1" />
            <Tab label="Access" id="employee-tab-2" aria-controls="employee-tabpanel-2" />
          </Tabs>
        </Box>

        {/* ── Tab 0: Profile (employment fields) ── */}
        <TabPanel value={tab} index={0}>
          <Box sx={{ p: 3 }}>
            <SectionLabel>Employment</SectionLabel>
            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="Full Name"
                  value={form.fullName}
                  onChange={(e) => setField('fullName', e.target.value)}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Department"
                  select
                  value={form.departmentId ?? ''}
                  onChange={(e) => setField('departmentId', e.target.value || null)}
                  fullWidth
                  size="small"
                >
                  <MenuItem value="">— None —</MenuItem>
                  {departments.map((d) => (
                    <MenuItem key={d.id} value={d.id}>
                      {d.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Hire Date"
                  type="date"
                  value={form.hireDate}
                  onChange={(e) => setField('hireDate', e.target.value)}
                  fullWidth
                  size="small"
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Manager"
                  select
                  value={form.managerId ?? ''}
                  onChange={(e) => setField('managerId', e.target.value || null)}
                  fullWidth
                  size="small"
                >
                  <MenuItem value="">— None —</MenuItem>
                  {managers.map((m) => (
                    <MenuItem key={m.id} value={m.id}>
                      {m.fullName}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Role"
                  select
                  value={form.role}
                  onChange={(e) => setField('role', e.target.value)}
                  fullWidth
                  size="small"
                >
                  <MenuItem value="employee">Employee</MenuItem>
                  <MenuItem value="manager">Manager</MenuItem>
                </TextField>
              </Grid>
            </Grid>
          </Box>

          {/* Sticky save footer */}
          <Box
            sx={{
              px: 3,
              py: 2,
              borderTop: 1,
              borderColor: 'divider',
              backgroundColor: 'background.paper',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Button variant="contained" onClick={handleSaveProfile} disabled={saving}>
              {saving ? 'Saving…' : 'Save Profile'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Employment fields only
            </Typography>
          </Box>
        </TabPanel>

        {/* ── Tab 1: Contact ── */}
        <TabPanel value={tab} index={1}>
          <Box sx={{ p: 3 }}>
            <SectionLabel>Phone</SectionLabel>
            <Grid container spacing={2.5} sx={{ mb: 3 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Phone"
                  value={form.phone ?? ''}
                  onChange={(e) => setField('phone', e.target.value || null)}
                  fullWidth
                  size="small"
                  placeholder="+1 555 000 0000"
                />
              </Grid>
            </Grid>

            <Divider sx={{ mb: 3 }} />

            <SectionLabel>Address</SectionLabel>
            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="Street"
                  value={form.street ?? ''}
                  onChange={(e) => setField('street', e.target.value || null)}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="City"
                  value={form.city ?? ''}
                  onChange={(e) => setField('city', e.target.value || null)}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="State / Province"
                  value={form.state ?? ''}
                  onChange={(e) => setField('state', e.target.value || null)}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Postal Code"
                  value={form.postalCode ?? ''}
                  onChange={(e) => setField('postalCode', e.target.value || null)}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Country"
                  value={form.country ?? ''}
                  onChange={(e) => setField('country', e.target.value || null)}
                  fullWidth
                  size="small"
                />
              </Grid>
            </Grid>
          </Box>

          {/* Sticky save footer — contact fields are included in the same profile PATCH */}
          <Box
            sx={{
              px: 3,
              py: 2,
              borderTop: 1,
              borderColor: 'divider',
              backgroundColor: 'background.paper',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Button variant="contained" onClick={handleSaveProfile} disabled={saving}>
              {saving ? 'Saving…' : 'Save Contact'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Contact &amp; address fields
            </Typography>
          </Box>
        </TabPanel>

        {/* ── Tab 2: Access (groups + permissions) ── */}
        <TabPanel value={tab} index={2}>
          {/* Groups sub-section */}
          <Box sx={{ p: 3 }}>
            <Box
              sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <GroupsOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <SectionLabel>Groups</SectionLabel>
              </Box>
            </Box>
            <Autocomplete
              multiple
              options={allGroups}
              value={selectedGroups}
              onChange={(_, newValue) => setSelectedGroups(newValue)}
              getOptionLabel={(o) => o.groupName}
              isOptionEqualToValue={(o, v) => o.groupId === v.groupId}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => {
                  const { key, ...tagProps } = getTagProps({ index })
                  return (
                    <Chip
                      key={key}
                      label={option.groupName}
                      size="small"
                      {...tagProps}
                    />
                  )
                })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  placeholder={selectedGroups.length === 0 ? 'Search groups…' : ''}
                />
              )}
              size="small"
            />
          </Box>

          <Box
            sx={{
              px: 3,
              py: 2,
              borderTop: 1,
              borderColor: 'divider',
              backgroundColor: 'action.hover',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Button
              variant="outlined"
              size="small"
              onClick={handleSaveGroups}
              disabled={savingGroups}
            >
              {savingGroups ? 'Saving…' : 'Save Groups'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Saves group memberships for this user
            </Typography>
          </Box>

          <Divider />

          {/* Permissions sub-section */}
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <ShieldOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              <SectionLabel>Access</SectionLabel>
            </Box>

            {allPermissions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No permissions defined in the system.
              </Typography>
            ) : (
              <PermissionMatrix
                allPermissions={allPermissions}
                grantedKeys={grantedPerms}
                onToggle={handlePermissionToggle}
                inheritedSources={inheritedSources}
              />
            )}
          </Box>

          <Box
            sx={{
              px: 3,
              py: 2,
              borderTop: 1,
              borderColor: 'divider',
              backgroundColor: 'background.paper',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Button
              variant="contained"
              onClick={handleSavePermissions}
              disabled={savingPerms}
            >
              {savingPerms ? 'Saving…' : 'Save Permissions'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Saves direct grants — dimmed checkmarks are inherited via groups or department
            </Typography>
          </Box>
        </TabPanel>
      </Paper>

    </>
  )
}
