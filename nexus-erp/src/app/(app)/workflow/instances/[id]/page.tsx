import { redirect, notFound } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import IconButton from '@mui/material/IconButton'
import Grid from '@mui/material/Grid'
import Divider from '@mui/material/Divider'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import { auth } from '@/auth'
import { getInstance, getInstanceEvents } from '@/lib/workflow'
import InstanceActions from '@/components/InstanceActions'

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary'> = {
  active: 'success', suspended: 'warning', completed: 'default', terminated: 'error', pending: 'info',
}

const TOKEN_STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary'> = {
  active: 'primary', waiting: 'warning', suspended: 'warning', cancelled: 'default', completed: 'success',
}

const DetailRow = ({ label, children }: { label: string; children: React.ReactNode }) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}

const InstanceDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const { id } = await params

  const [data, events] = await Promise.all([
    getInstance(id),
    getInstanceEvents(id).catch(() => []),
  ])

  if (!data) notFound()

  const { instance, tokens, variables } = data

  const variableEntries = Object.entries(variables)

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton href="/workflow/instances" size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3">{instance.definitionId}</Typography>
        <Chip label={instance.status} size="small" color={STATUS_COLORS[instance.status] ?? 'default'} />
        <Box sx={{ ml: 'auto' }}>
          <InstanceActions instanceId={id} status={instance.status} />
        </Box>
      </Box>

      <Stack spacing={3}>
        {/* Instance info */}
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
            <Typography variant="h5" sx={{ mb: 2.5 }}>Instance Details</Typography>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Stack spacing={2.5} divider={<Divider />}>
                  <DetailRow label="Instance ID">
                    <Typography variant="body2" fontWeight={500} sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{id}</Typography>
                  </DetailRow>
                  <DetailRow label="Definition">
                    <Typography variant="body2" fontWeight={500}>{instance.definitionId}</Typography>
                  </DetailRow>
                  <DetailRow label="Version">
                    <Typography variant="body2" fontWeight={500}>v{instance.definitionVersion}</Typography>
                  </DetailRow>
                </Stack>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Stack spacing={2.5} divider={<Divider />}>
                  <DetailRow label="Started">
                    <Typography variant="body2" fontWeight={500}>{new Date(instance.startedAt).toLocaleString()}</Typography>
                  </DetailRow>
                  <DetailRow label="Completed">
                    <Typography variant="body2" fontWeight={500}>{instance.completedAt ? new Date(instance.completedAt).toLocaleString() : '—'}</Typography>
                  </DetailRow>
                  <DetailRow label="Status">
                    <Box><Chip label={instance.status} size="small" color={STATUS_COLORS[instance.status] ?? 'default'} /></Box>
                  </DetailRow>
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Active tokens */}
        {tokens.length > 0 && (
          <Card>
            <CardContent sx={{ p: 3, '&:last-child': { pb: 0 } }}>
              <Typography variant="h5" sx={{ mb: 2 }}>Active Tokens ({tokens.length})</Typography>
            </CardContent>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Token ID</TableCell>
                  <TableCell>Element</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Waiting For</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{token.id.slice(0, 8)}…</TableCell>
                    <TableCell><Typography variant="body2" fontWeight={500}>{token.elementId}</Typography></TableCell>
                    <TableCell><Typography variant="body2" color="text.secondary">{token.elementType}</Typography></TableCell>
                    <TableCell>
                      <Chip label={token.status} size="small" color={TOKEN_STATUS_COLORS[token.status] ?? 'default'} />
                    </TableCell>
                    <TableCell>
                      {token.waitingFor ? (
                        <Chip label={token.waitingFor.type} size="small" variant="outlined" />
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Variables */}
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
            <Typography variant="h5" sx={{ mb: 2 }}>Variables</Typography>
            {variableEntries.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No variables in scope.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {variableEntries.map(([key, val]) => {
                    const v = val as { type: string; value: unknown }
                    return (
                      <TableRow key={key}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{key}</TableCell>
                        <TableCell><Chip label={v?.type ?? 'unknown'} size="small" variant="outlined" /></TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {JSON.stringify(v?.value)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Event log */}
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 0 } }}>
            <Typography variant="h5" sx={{ mb: 2 }}>Event Log ({events.length})</Typography>
          </CardContent>
          {events.length === 0 ? (
            <CardContent sx={{ pt: 0, pb: 3 }}>
              <Typography variant="body2" color="text.secondary">No events recorded.</Typography>
            </CardContent>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Event Type</TableCell>
                  <TableCell>Element</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(ev.occurredAt).toLocaleTimeString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={ev.type} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}>
                      {(ev.data as Record<string, unknown>).elementId as string ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </Stack>
    </Box>
  )
}
export default InstanceDetailPage
