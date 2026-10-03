import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import KeyRoundedIcon from '@mui/icons-material/KeyRounded'
import PauseCircleOutlineRoundedIcon from '@mui/icons-material/PauseCircleOutlineRounded'
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type { AdminApi } from '../api/client'
import type { Tenant } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { CreateTenantDialog } from '../components/CreateTenantDialog'
import { KeysDrawer } from '../components/KeysDrawer'
import { StatusChip } from '../components/StatusChip'
import { PageHeader } from '../components/PageHeader'
import { ListFooter, ListToolbar, SortHeader } from '../list/ListControls'
import { useListView } from '../list/useListView'
import { formatDate } from '../format'

/** A number for a table cell, or a dash where it is not known (a tenant being deleted). */
const count = (n: number | undefined) => (n === undefined ? '—' : n)

/** Owns pre-multi-tenancy data; the API refuses to delete it. */
const PROTECTED_TENANT_ID = 'default'

// What the search looks in, and what each sortable column sorts by (module level: stable between renders)
const tenantText = (t: Tenant) => `${t.name} ${t.id} ${t.status}`
const tenantSort = {
  name: (t: Tenant) => t.name,
  status: (t: Tenant) => t.status,
  keys: (t: Tenant) => t.activeKeyCount,
  running: (t: Tenant) => t.counts?.instances.active,
  suspended: (t: Tenant) => t.counts?.instances.suspended,
  tasks: (t: Tenant) => t.counts?.pendingTasks,
  created: (t: Tenant) => t.createdAt,
}

export function TenantsPage({ api }: { api: AdminApi }) {
  const [tenants, setTenants] = useState<Tenant[] | null>(null)
  const view = useListView(tenants, { searchText: tenantText, sortValues: tenantSort })
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Tenant | null>(null)
  const [keysFor, setKeysFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setTenants(await api.listTenants())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the tenants')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  async function run(tenant: Tenant, action: () => Promise<unknown>, success: string) {
    setBusyId(tenant.id)
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

  const setStatus = (tenant: Tenant, status: 'active' | 'suspended') =>
    run(
      tenant,
      () => api.updateTenant(tenant.id, { status }),
      status === 'suspended' ? `Suspended ${tenant.id}` : `Reactivated ${tenant.id}`,
    )

  // Read the tenant fresh from the list so the drawer reflects status/key-count changes.
  const keysTenant = tenants?.find((t) => t.id === keysFor) ?? null

  return (
    <Box>
      <PageHeader title="Tenants" group="Platform">
        <Tooltip title="Refresh">
          <IconButton aria-label="Refresh" onClick={() => void load()}>
            <RefreshRoundedIcon />
          </IconButton>
        </Tooltip>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setCreating(true)}>
          New tenant
        </Button>
      </PageHeader>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      {tenants === null && !error ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading tenants" />
        </Box>
      ) : (
        <>
          <ListToolbar pageSize={view.pageSize} onPageSize={view.setPageSize} query={view.query} onQuery={view.setQuery} searchLabel="Search tenants" />
          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Table>
            <TableHead>
              <TableRow>
                <SortHeader label="Tenant" sortKey="name" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Status" sortKey="status" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Active keys" sortKey="keys" align="right" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Running" sortKey="running" align="right" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Suspended" sortKey="suspended" align="right" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Open tasks" sortKey="tasks" align="right" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Created" sortKey="created" sort={view.sort} onSort={view.toggleSort} />
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {view.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    {view.query.trim() !== '' ? 'Nothing matches your search' : 'No tenants yet'}
                  </TableCell>
                </TableRow>
              )}
              {view.rows.map((tenant) => {
                const busy = busyId === tenant.id
                const beingDeleted = tenant.status === 'deleting'
                return (
                  <TableRow key={tenant.id} hover>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{tenant.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {tenant.id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <StatusChip status={tenant.status} />
                    </TableCell>
                    <TableCell align="right">{tenant.activeKeyCount}</TableCell>
                    <TableCell align="right">{count(tenant.counts?.instances.active)}</TableCell>
                    <TableCell align="right">{count(tenant.counts?.instances.suspended)}</TableCell>
                    <TableCell align="right">{count(tenant.counts?.pendingTasks)}</TableCell>
                    <TableCell>{formatDate(tenant.createdAt)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                        <Button size="small" startIcon={<KeyRoundedIcon />} disabled={busy} onClick={() => setKeysFor(tenant.id)} aria-label={`Keys for ${tenant.id}`}>
                          Keys
                        </Button>
                        {tenant.status === 'active' && (
                          <Button size="small" startIcon={<PauseCircleOutlineRoundedIcon />} disabled={busy} onClick={() => void setStatus(tenant, 'suspended')} aria-label={`Suspend ${tenant.id}`}>
                            Suspend
                          </Button>
                        )}
                        {tenant.status === 'suspended' && (
                          <Button size="small" startIcon={<PlayCircleOutlineRoundedIcon />} disabled={busy} onClick={() => void setStatus(tenant, 'active')} aria-label={`Reactivate ${tenant.id}`}>
                            Reactivate
                          </Button>
                        )}
                        <Tooltip title={tenant.id === PROTECTED_TENANT_ID ? 'The default tenant cannot be deleted' : beingDeleted ? 'Retry the delete' : 'Delete tenant'}>
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              disabled={busy || tenant.id === PROTECTED_TENANT_ID}
                              onClick={() => setDeleting(tenant)}
                              aria-label={beingDeleted ? `Retry delete ${tenant.id}` : `Delete ${tenant.id}`}
                            >
                              <DeleteOutlineRoundedIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
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

      <CreateTenantDialog
        open={creating}
        api={api}
        onClose={() => setCreating(false)}
        onCreated={(tenant) => {
          setCreating(false)
          setMessage({ severity: 'success', text: `Created ${tenant.id}` })
          void load()
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.status === 'deleting' ? 'Retry deleting this tenant?' : 'Delete this tenant?'}
        confirmLabel={deleting?.status === 'deleting' ? 'Retry delete' : 'Delete tenant'}
        requireText={deleting?.id}
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const tenant = deleting
          setDeleting(null)
          if (tenant) void run(tenant, () => api.deleteTenant(tenant.id), `Deleted ${tenant.id}`)
        }}
      >
        This permanently deletes <strong>{deleting?.id}</strong>: its workflow data, its database schema and all of its API
        keys. This cannot be undone.
      </ConfirmDialog>

      <KeysDrawer api={api} tenant={keysTenant} onClose={() => setKeysFor(null)} onChanged={() => void load()} />

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
