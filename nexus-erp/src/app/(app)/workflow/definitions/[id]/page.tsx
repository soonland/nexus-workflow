import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import NextLink from 'next/link'
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
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import { getFullDefinition, getDefinitionXml } from '@/lib/workflow'
import BpmnViewerLoader from '@/components/BpmnViewerLoader'

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}

// Colour-code BPMN element types
const TYPE_COLORS: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary' | 'secondary'> = {
  startEvent: 'success',
  endEvent: 'error',
  userTask: 'primary',
  serviceTask: 'secondary',
  exclusiveGateway: 'warning',
  parallelGateway: 'warning',
  inclusiveGateway: 'warning',
  intermediateCatchEvent: 'info',
  intermediateThrowEvent: 'info',
  boundaryEvent: 'info',
}

export default async function DefinitionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ version?: string }>
}) {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const { id } = await params
  const { version: versionParam } = await searchParams
  const version = versionParam !== undefined ? parseInt(versionParam, 10) : undefined

  const [def, xml] = await Promise.all([
    getFullDefinition(id, version),
    getDefinitionXml(id, version),
  ])
  if (!def) notFound()

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton component={NextLink} href="/workflow/definitions" size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3" sx={{ fontFamily: 'monospace' }}>{def.id}</Typography>
        <Chip label={`v${def.version}`} size="small" variant="outlined" />
        {def.isDeployable
          ? <CheckCircleRoundedIcon fontSize="small" color="success" />
          : <CancelRoundedIcon fontSize="small" color="error" />
        }
      </Box>

      <Stack spacing={3}>
        {/* Metadata */}
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
            <Typography variant="h5" sx={{ mb: 2.5 }}>Metadata</Typography>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Stack spacing={2.5} divider={<Divider />}>
                  <DetailRow label="Definition ID">
                    <Typography variant="body2" fontWeight={500} sx={{ fontFamily: 'monospace' }}>{def.id}</Typography>
                  </DetailRow>
                  <DetailRow label="Name">
                    <Typography variant="body2" fontWeight={500}>{def.name ?? '—'}</Typography>
                  </DetailRow>
                  <DetailRow label="Start Event">
                    <Typography variant="body2" fontWeight={500} sx={{ fontFamily: 'monospace' }}>{def.startEventId}</Typography>
                  </DetailRow>
                </Stack>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Stack spacing={2.5} divider={<Divider />}>
                  <DetailRow label="Version">
                    <Typography variant="body2" fontWeight={500}>v{def.version}</Typography>
                  </DetailRow>
                  <DetailRow label="Deployable">
                    <Box>{def.isDeployable
                      ? <CheckCircleRoundedIcon fontSize="small" color="success" />
                      : <CancelRoundedIcon fontSize="small" color="error" />
                    }</Box>
                  </DetailRow>
                  <DetailRow label="Deployed At">
                    <Typography variant="body2" fontWeight={500}>{new Date(def.deployedAt).toLocaleString()}</Typography>
                  </DetailRow>
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* BPMN Diagram */}
        {xml && (
          <Card>
            <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
              <Typography variant="h5" sx={{ mb: 2 }}>Diagram</Typography>
              <BpmnViewerLoader xml={xml} />
            </CardContent>
          </Card>
        )}

        {/* Elements */}
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 0 } }}>
            <Typography variant="h5">
              Elements <Chip label={def.elements.length} size="small" sx={{ ml: 1 }} />
            </Typography>
          </CardContent>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Incoming</TableCell>
                <TableCell>Outgoing</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {def.elements.map((el) => (
                <TableRow key={el.id} sx={{ '&:hover': { backgroundColor: 'action.hover' } }}>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{el.id}</TableCell>
                  <TableCell>
                    <Chip label={el.type} size="small" color={TYPE_COLORS[el.type] ?? 'default'} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{el.name ?? '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{el.incomingFlows.length}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{el.outgoingFlows.length}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        {/* Sequence Flows */}
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 0 } }}>
            <Typography variant="h5">
              Sequence Flows <Chip label={def.sequenceFlows.length} size="small" sx={{ ml: 1 }} />
            </Typography>
          </CardContent>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Condition</TableCell>
                <TableCell>Default</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {def.sequenceFlows.map((flow) => (
                <TableRow key={flow.id} sx={{ '&:hover': { backgroundColor: 'action.hover' } }}>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{flow.id}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{flow.sourceRef}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{flow.targetRef}</TableCell>
                  <TableCell>
                    {flow.conditionExpression
                      ? <code style={{ fontSize: '0.75rem', background: 'rgba(0,0,0,0.06)', padding: '2px 6px', borderRadius: 4 }}>{flow.conditionExpression}</code>
                      : <Typography variant="body2" color="text.secondary">—</Typography>
                    }
                  </TableCell>
                  <TableCell>
                    {flow.isDefault
                      ? <CheckCircleRoundedIcon fontSize="small" color="success" />
                      : <Typography variant="body2" color="text.secondary">—</Typography>
                    }
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Stack>
    </Box>
  )
}
