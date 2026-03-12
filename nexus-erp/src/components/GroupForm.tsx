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
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import { useSnackbar } from '@/components/SnackbarContext'
import PermissionMatrix from '@/components/PermissionMatrix'

interface UserOption {
  userId: string
  fullName: string
  email: string
}

interface GroupFormProps {
  mode: 'create' | 'edit'
  groupId?: string
  defaultName?: string
  defaultDescription?: string
  defaultType?: 'security' | 'default'
  defaultPermissions?: string[]
  defaultMembers?: UserOption[]
  allPermissions: Array<{ key: string; label: string; type: string }>
  allUsers: UserOption[]
}

type Status = 'idle' | 'saving'

export default function GroupForm({
  mode,
  groupId,
  defaultName = '',
  defaultDescription = '',
  defaultType = 'security',
  defaultPermissions = [],
  defaultMembers = [],
  allPermissions,
  allUsers,
}: GroupFormProps) {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()

  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState(defaultDescription)
  const [groupType, setGroupType] = useState<'security' | 'default'>(defaultType)
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set(defaultPermissions))
  const [members, setMembers] = useState<UserOption[]>(
    defaultMembers.map(
      (m) => allUsers.find((u) => u.userId === m.userId) ?? m
    )
  )
  const [status, setStatus] = useState<Status>('idle')

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
      if (mode === 'create') {
        const res = await fetch('/api/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || undefined,
            type: groupType,
            permissionKeys: Array.from(selectedPerms),
            memberUserIds: groupType === 'security' ? members.map((m) => m.userId) : [],
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? `Error ${res.status}`)
        }
        const newGroup = await res.json()
        router.push(`/groups/${newGroup.id}`)
      } else {
        const requests: Promise<Response>[] = [
          fetch(`/api/groups/${groupId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), description: description.trim() || null, type: groupType }),
          }),
          fetch(`/api/groups/${groupId}/permissions`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissionKeys: Array.from(selectedPerms) }),
          }),
        ]
        // Only sync members for security groups
        if (groupType === 'security') {
          requests.push(
            fetch(`/api/groups/${groupId}/members`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userIds: members.map((m) => m.userId) }),
            })
          )
        }
        const results = await Promise.all(requests)
        for (const r of results) {
          if (!r.ok) {
            const data = await r.json().catch(() => ({}))
            throw new Error(data.error ?? `Error ${r.status}`)
          }
        }
        showSnackbar({ message: 'Changes saved.', severity: 'success' })
        router.refresh()
      }
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    } finally {
      setStatus('idle')
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton component={NextLink} href="/groups" size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3">
          {mode === 'create' ? 'New Group' : (defaultName || 'Edit Group')}
        </Typography>
        {groupType === 'default' && (
          <Chip label="Default Group" size="small" color="primary" variant="outlined" sx={{ fontWeight: 600 }} />
        )}
      </Box>

      <Card sx={{ maxWidth: 720 }}>
        <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
          <Stack spacing={3} divider={<Divider />}>
            {/* Details section */}
            <Box>
              <Typography variant="overline" color="text.secondary">Details</Typography>
              <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                <TextField
                  label="Group Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  fullWidth
                  size="small"
                  autoFocus={mode === 'create'}
                />
                <TextField
                  label="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  fullWidth
                  size="small"
                  multiline
                  rows={2}
                  placeholder="Optional description"
                />

                {/* Group type toggle */}
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Group Type
                  </Typography>
                  <ToggleButtonGroup
                    value={groupType}
                    exclusive
                    onChange={(_, v) => { if (v) setGroupType(v) }}
                    size="small"
                  >
                    <Tooltip title="Explicit membership — users must be added manually">
                      <ToggleButton value="security" sx={{ gap: 0.75, px: 2 }}>
                        <LockRoundedIcon fontSize="small" />
                        Security
                      </ToggleButton>
                    </Tooltip>
                    <Tooltip title="All authenticated users automatically belong to this group">
                      <ToggleButton value="default" sx={{ gap: 0.75, px: 2 }}>
                        <GroupsRoundedIcon fontSize="small" />
                        Default
                      </ToggleButton>
                    </Tooltip>
                  </ToggleButtonGroup>
                  {groupType === 'default' && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                      All users inherit this group's permissions — no membership needed.
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Box>

            {/* Permissions section */}
            <Box>
              {allPermissions.length === 0 ? (
                <>
                  <Typography variant="overline" color="text.secondary">Permissions</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No permissions defined.</Typography>
                </>
              ) : (
                <PermissionMatrix
                  allPermissions={allPermissions}
                  grantedKeys={selectedPerms}
                  onToggle={handlePermToggle}
                />
              )}
            </Box>

            {/* Members section — hidden for default groups */}
            {groupType === 'security' && (
              <Box>
                <Typography variant="overline" color="text.secondary">Members</Typography>
                <Box sx={{ mt: 1.5 }}>
                  <Autocomplete
                    multiple
                    options={allUsers}
                    value={members}
                    onChange={(_, newValue) => setMembers(newValue)}
                    getOptionLabel={(u) => `${u.fullName} (${u.email})`}
                    isOptionEqualToValue={(option, value) => option.userId === value.userId}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          label={option.fullName}
                          size="small"
                          {...getTagProps({ index })}
                          key={option.userId}
                        />
                      ))
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Members"
                        size="small"
                        placeholder={members.length === 0 ? 'Search users…' : undefined}
                      />
                    )}
                    noOptionsText="No users found"
                  />
                </Box>
              </Box>
            )}

            {/* Actions */}
            <Box>
              <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                <Button component={NextLink} href="/groups" variant="text">
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={handleSubmit}
                  disabled={!name.trim() || status === 'saving'}
                >
                  {status === 'saving'
                    ? (mode === 'create' ? 'Creating…' : 'Saving…')
                    : (mode === 'create' ? 'Create Group' : 'Save Changes')}
                </Button>
              </Stack>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
