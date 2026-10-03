import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type { AdminApi } from '../api/client'
import type { Invite, Membership, UserWithMemberships } from '../api/types'
import { isOperator, managedTenantIds, type Session } from '../auth/roles'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { CreateUserDialog } from '../components/CreateUserDialog'
import { InviteLinkDialog } from '../components/InviteLinkDialog'
import { MembershipsDialog } from '../components/MembershipsDialog'
import { PageHeader } from '../components/PageHeader'
import { ListFooter, ListToolbar, SortHeader } from '../list/ListControls'
import { useListView } from '../list/useListView'
import { formatDate } from '../format'

const roleLabel = (m: Membership) => (m.role === 'operator' ? 'operator' : `manager · ${m.tenantId}`)

const roleText = (u: UserWithMemberships) => u.memberships.map(roleLabel).join(', ')
const userStatus = (u: UserWithMemberships) => (u.status === 'disabled' ? 'disabled' : u.hasPassword ? 'active' : 'invited')
// What the search looks in, and what each sortable column sorts by (module level: stable between renders)
const userText = (u: UserWithMemberships) => `${u.name} ${u.email} ${roleText(u)} ${userStatus(u)}`
const userSort = {
  name: (u: UserWithMemberships) => u.name,
  roles: roleText,
  status: userStatus,
  lastLogin: (u: UserWithMemberships) => u.lastLoginAt,
}

export function UsersPage({ api, session }: { api: AdminApi; session: Session }) {
  const operator = isOperator(session)
  const managed = managedTenantIds(session)
  const ownId = session.kind === 'user' ? session.user.id : null

  const [users, setUsers] = useState<UserWithMemberships[] | null>(null)
  const view = useListView(users, { searchText: userText, sortValues: userSort })
  const [tenantIds, setTenantIds] = useState<string[]>(managed.slice().sort())
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [invite, setInvite] = useState<{ invite: Invite; name: string } | null>(null)
  const [rolesFor, setRolesFor] = useState<string | null>(null)
  const [disabling, setDisabling] = useState<UserWithMemberships | null>(null)

  const load = useCallback(async () => {
    try {
      setUsers(await api.listUsers())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the users')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  // Operators may give a manager role for any tenant; managers only for the ones they manage
  useEffect(() => {
    if (!operator) return
    api
      .listTenants()
      .then((tenants) => setTenantIds(tenants.map((t) => t.id)))
      .catch(() => undefined) // the role form just offers no tenants; the list itself shows real errors
  }, [api, operator])

  async function run(user: UserWithMemberships, action: () => Promise<unknown>, success: string) {
    setBusyId(user.id)
    try {
      await action()
      setMessage({ severity: 'success', text: success })
    } catch (err) {
      setMessage({ severity: 'error', text: err instanceof Error ? err.message : 'The action failed' })
    } finally {
      setBusyId(null)
      await load()
    }
  }

  const reinvite = (user: UserWithMemberships) =>
    run(user, async () => setInvite({ invite: await api.reinviteUser(user.id), name: user.name }), `New invitation for ${user.name}`)

  // Read the person fresh from the list so the dialog reflects the changes made in it
  const rolesUser = users?.find((u) => u.id === rolesFor) ?? null
  const canRemove = (m: Membership) => operator || (m.tenantId !== null && managed.includes(m.tenantId))

  return (
    <Box>
      <PageHeader title="Users" group="People">
        <Tooltip title="Refresh">
          <IconButton aria-label="Refresh" onClick={() => void load()}>
            <RefreshRoundedIcon />
          </IconButton>
        </Tooltip>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setCreating(true)}>
          Invite person
        </Button>
      </PageHeader>

      {!operator && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You see the people who belong only to {managed.length === 1 ? 'your tenant' : 'your tenants'} ({managed.join(', ')}).
        </Typography>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      {users === null && !error ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading users" />
        </Box>
      ) : (
        <>
          <ListToolbar pageSize={view.pageSize} onPageSize={view.setPageSize} query={view.query} onQuery={view.setQuery} searchLabel="Search people" />
          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Table>
            <TableHead>
              <TableRow>
                <SortHeader label="Person" sortKey="name" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Roles" sortKey="roles" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Status" sortKey="status" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Last sign-in" sortKey="lastLogin" sort={view.sort} onSort={view.toggleSort} />
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {view.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    {view.query.trim() !== '' ? 'Nothing matches your search' : 'No users yet'}
                  </TableCell>
                </TableRow>
              )}
              {view.rows.map((user) => {
                const busy = busyId === user.id
                const self = user.id === ownId
                return (
                  <TableRow key={user.id} hover>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{user.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {user.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        {user.memberships.length === 0 && <Typography variant="body2" color="text.secondary">none</Typography>}
                        {user.memberships.map((m) => (
                          <Chip key={m.id} size="small" variant="outlined" label={roleLabel(m)} />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {user.status === 'disabled' ? (
                        <Chip size="small" color="warning" variant="outlined" label="disabled" />
                      ) : user.hasPassword ? (
                        <Chip size="small" color="success" label="active" />
                      ) : (
                        <Chip size="small" variant="outlined" label="invited" />
                      )}
                    </TableCell>
                    <TableCell>{formatDate(user.lastLoginAt)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                        <Button size="small" disabled={busy} onClick={() => setRolesFor(user.id)} aria-label={`Roles of ${user.email}`}>
                          Roles
                        </Button>
                        {user.status === 'active' && (
                          <Button size="small" disabled={busy} onClick={() => void reinvite(user)} aria-label={`New invitation for ${user.email}`}>
                            New link
                          </Button>
                        )}
                        {user.status === 'active' && !self && (
                          <Button size="small" color="warning" disabled={busy} onClick={() => setDisabling(user)} aria-label={`Disable ${user.email}`}>
                            Disable
                          </Button>
                        )}
                        {user.status === 'disabled' && (
                          <Button
                            size="small"
                            disabled={busy}
                            onClick={() => void run(user, () => api.setUserStatus(user.id, 'active'), `Re-enabled ${user.name}`)}
                            aria-label={`Enable ${user.email}`}
                          >
                            Enable
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <ListFooter page={view.page} onPage={view.setPage} pageSize={view.pageSize} filteredCount={view.filteredCount} totalCount={view.totalCount} />
        </TableContainer>
        </>
      )}

      <CreateUserDialog
        open={creating}
        api={api}
        tenantIds={tenantIds}
        canAssignOperator={operator}
        onClose={() => setCreating(false)}
        onCreated={(user, created) => {
          setCreating(false)
          setInvite({ invite: created, name: user.name })
          void load()
        }}
      />

      <InviteLinkDialog invite={invite?.invite ?? null} name={invite?.name ?? ''} onClose={() => setInvite(null)} />

      <MembershipsDialog
        user={rolesUser}
        api={api}
        tenantIds={tenantIds}
        canAssignOperator={operator}
        canRemove={canRemove}
        onClose={() => setRolesFor(null)}
        onChanged={() => void load()}
      />

      <ConfirmDialog
        open={disabling !== null}
        title="Disable this person?"
        confirmLabel="Disable"
        destructive
        onCancel={() => setDisabling(null)}
        onConfirm={() => {
          const user = disabling
          setDisabling(null)
          if (user) void run(user, () => api.setUserStatus(user.id, 'disabled'), `Disabled ${user.name}`)
        }}
      >
        <strong>{disabling?.name}</strong> is signed out straight away and cannot sign in again until you enable them.
      </ConfirmDialog>

      <Snackbar
        open={message !== null}
        autoHideDuration={5000}
        onClose={() => setMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {message ? (
          <Alert severity={message.severity} onClose={() => setMessage(null)} variant="filled">
            {message.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  )
}
