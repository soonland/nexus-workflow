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
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import { useTranslations } from 'next-intl'
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

const SectionLabel = ({ children, sx }: { children: React.ReactNode; sx?: object }) => (
  <Typography
    variant="overline"
    color="text.secondary"
    sx={{ display: 'block', mb: 2, letterSpacing: '0.08em', ...sx }}
  >
    {children}
  </Typography>
)

// ── Main component ────────────────────────────────────────────────────────────

const EmployeeEditForm = ({
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
}: EmployeeEditFormProps) => {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const t = useTranslations('employees.edit')

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

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Error ${res.status}`)
      }
      showSnackbar({ message: t('messages.profileSaved'), severity: 'success' })
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
        throw new Error((data as { error?: string }).error ?? `Error ${res.status}`)
      }
      showSnackbar({ message: t('messages.permissionsSaved'), severity: 'success' })
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
        throw new Error((data as { error?: string }).error ?? `Error ${res.status}`)
      }
      showSnackbar({ message: t('messages.groupsSaved'), severity: 'success' })
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
      {/* ── Employment + Contact card ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
        {/* Employment section */}
        <Box sx={{ p: 3 }}>
          <SectionLabel>{t('sections.employment')}</SectionLabel>
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label={t('fields.fullName')}
                value={form.fullName}
                onChange={(e) => setField('fullName', e.target.value)}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.department')}
                select
                value={form.departmentId ?? ''}
                onChange={(e) => setField('departmentId', e.target.value || null)}
                fullWidth
                size="small"
              >
                <MenuItem value="">{t('placeholders.noDepartment')}</MenuItem>
                {departments.map((d) => (
                  <MenuItem key={d.id} value={d.id}>
                    {d.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.hireDate')}
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
                label={t('fields.manager')}
                select
                value={form.managerId ?? ''}
                onChange={(e) => setField('managerId', e.target.value || null)}
                fullWidth
                size="small"
              >
                <MenuItem value="">{t('placeholders.noManager')}</MenuItem>
                {managers.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.fullName}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.role')}
                select
                value={form.role}
                onChange={(e) => setField('role', e.target.value)}
                fullWidth
                size="small"
              >
                <MenuItem value="employee">{t('roles.employee')}</MenuItem>
                <MenuItem value="manager">{t('roles.manager')}</MenuItem>
              </TextField>
            </Grid>
          </Grid>
        </Box>

        <Divider />

        {/* Contact & Address section */}
        <Box sx={{ p: 3 }}>
          <SectionLabel>{t('sections.contactAddress')}</SectionLabel>
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.phone')}
                value={form.phone ?? ''}
                onChange={(e) => setField('phone', e.target.value || null)}
                fullWidth
                size="small"
                placeholder="+1 555 000 0000"
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label={t('fields.street')}
                value={form.street ?? ''}
                onChange={(e) => setField('street', e.target.value || null)}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.city')}
                value={form.city ?? ''}
                onChange={(e) => setField('city', e.target.value || null)}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.state')}
                value={form.state ?? ''}
                onChange={(e) => setField('state', e.target.value || null)}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.postalCode')}
                value={form.postalCode ?? ''}
                onChange={(e) => setField('postalCode', e.target.value || null)}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('fields.country')}
                value={form.country ?? ''}
                onChange={(e) => setField('country', e.target.value || null)}
                fullWidth
                size="small"
              />
            </Grid>
          </Grid>
        </Box>

        {/* Save footer */}
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
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? t('save.saving') : t('save.profile')}
          </Button>
        </Box>
      </Paper>

      {/* ── Access card (groups + permissions) ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {/* Groups sub-section */}
        <Box sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <GroupsOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <SectionLabel sx={{ mb: 0 }}>{t('sections.groups')}</SectionLabel>
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
                  <Chip key={key} label={option.groupName} size="small" {...tagProps} />
                )
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                placeholder={selectedGroups.length === 0 ? t('placeholders.searchGroups') : ''}
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
          <Button variant="outlined" size="small" onClick={handleSaveGroups} disabled={savingGroups}>
            {savingGroups ? t('save.saving') : t('save.groups')}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {t('hints.groupsMembership')}
          </Typography>
        </Box>

        <Divider />

        {/* Permissions sub-section */}
        <Box sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <ShieldOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <SectionLabel sx={{ mb: 0 }}>{t('sections.access')}</SectionLabel>
          </Box>

          {allPermissions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('noPermissions')}
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
          <Button variant="contained" onClick={handleSavePermissions} disabled={savingPerms}>
            {savingPerms ? t('save.saving') : t('save.permissions')}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {t('hints.permissionsGrants')}
          </Typography>
        </Box>
      </Paper>
    </>
  )
}

export default EmployeeEditForm
