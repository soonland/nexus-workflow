import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Stack from '@mui/material/Stack'
import Button from '@mui/material/Button'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import { listInstances } from '@/lib/workflow'
import InstanceActions from '@/components/InstanceActions'

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary'> = {
  active: 'success',
  suspended: 'warning',
  completed: 'default',
  terminated: 'error',
  pending: 'info',
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'completed', label: 'Completed' },
  { value: 'terminated', label: 'Terminated' },
]

export default async function WorkflowInstancesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const { status, page: pageParam } = await searchParams
  const page = Number(pageParam ?? 0)
  const pageSize = 20

  let result
  try {
    result = await listInstances({ status: status || undefined, page, pageSize })
  } catch {
    result = { items: [], total: 0, page: 0, pageSize }
  }

  const { items: instances, total } = result

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h2">Workflow Instances</Typography>
        <Chip label={total} size="small" color="primary" />
      </Box>

      {/* Status filter */}
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          {STATUS_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              component={NextLink}
              href={opt.value ? `/workflow/instances?status=${opt.value}` : '/workflow/instances'}
              size="small"
              variant={(status ?? '') === opt.value ? 'contained' : 'outlined'}
              color="primary"
            >
              {opt.label}
            </Button>
          ))}
        </Stack>
      </Box>

      <Card>
        {instances.length === 0 ? (
          <Stack alignItems="center" spacing={2} sx={{ py: 8 }}>
            <AccountTreeRoundedIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
            <Typography variant="body1" color="text.secondary">
              No instances found.
            </Typography>
          </Stack>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Instance ID</TableCell>
                <TableCell>Definition</TableCell>
                <TableCell>Ver.</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Completed</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {instances.map((inst) => (
                <TableRow
                  key={inst.id}
                  sx={{ '&:hover': { backgroundColor: 'action.hover' } }}
                >
                  <TableCell>
                    <Button
                      component={NextLink}
                      href={`/workflow/instances/${inst.id}`}
                      variant="text"
                      size="small"
                      sx={{ fontFamily: 'monospace', fontSize: '0.75rem', p: 0, minWidth: 0 }}
                    >
                      {inst.id.slice(0, 8)}…
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{inst.definitionId}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">v{inst.definitionVersion}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={inst.status}
                      size="small"
                      color={STATUS_COLORS[inst.status] ?? 'default'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(inst.startedAt).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {inst.completedAt ? new Date(inst.completedAt).toLocaleString() : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <InstanceActions instanceId={inst.id} status={inst.status} />
                      <Button
                        component={NextLink}
                        href={`/workflow/instances/${inst.id}`}
                        size="small"
                        variant="contained"
                      >
                        View
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Pagination */}
      {total > pageSize && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
          {page > 0 && (
            <Button
              component={NextLink}
              href={`/workflow/instances?${status ? `status=${status}&` : ''}page=${page - 1}`}
              variant="outlined"
              size="small"
            >
              Previous
            </Button>
          )}
          <Typography variant="body2" sx={{ alignSelf: 'center', color: 'text.secondary' }}>
            Page {page + 1} of {Math.ceil(total / pageSize)}
          </Typography>
          {(page + 1) * pageSize < total && (
            <Button
              component={NextLink}
              href={`/workflow/instances?${status ? `status=${status}&` : ''}page=${page + 1}`}
              variant="outlined"
              size="small"
            >
              Next
            </Button>
          )}
        </Box>
      )}
    </Box>
  )
}
