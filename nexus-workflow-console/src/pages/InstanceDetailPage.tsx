import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import type { TenantApi } from '../api/client'
import type { HistoryEntry, InstanceView } from '../api/types'
import { InstanceStatusChip } from '../components/InstanceStatusChip'
import { PageHeader } from '../components/PageHeader'
import { formatDate } from '../format'

// Loaded on demand: the diagram library is large and only this page needs it
const BpmnDiagram = lazy(() => import('../components/BpmnDiagram'))

/** Catches the diagram failing to load (offline, chunk missing) so the rest of the page still works. */
class DiagramBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const duration = (entry: HistoryEntry) => {
  const ms = new Date(entry.completedAt).getTime() - new Date(entry.startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function InstanceDetailPage({ api, instanceId, onBack }: { api: TenantApi; instanceId: string; onBack(): void }) {
  const [view, setView] = useState<InstanceView | null>(null)
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [xml, setXml] = useState<string | null | 'unavailable'>(null)
  const [error, setError] = useState<string | null>(null)
  const [diagramError, setDiagramError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [loaded, entries] = await Promise.all([api.getInstance(instanceId), api.getInstanceHistory(instanceId)])
      setView(loaded)
      setHistory(entries)
      setError(null)
      // The diagram is a bonus: if the XML is missing, the rest of the page still stands
      try {
        setXml(await api.getDefinitionXml(loaded.instance.definitionId, loaded.instance.definitionVersion))
      } catch {
        setXml('unavailable')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the instance')
    }
  }, [api, instanceId])

  useEffect(() => {
    void load()
  }, [load])

  const onDiagramError = useCallback((message: string) => setDiagramError(message), [])

  // What to mark on the diagram: where the instance is, where it has been, where it went wrong
  const marks = useMemo(() => {
    const activeIds = [...new Set((view?.tokens ?? []).map((t) => t.elementId))]
    const entries = history ?? []
    const failed = (e: HistoryEntry) => e.status !== 'completed'
    return {
      activeIds,
      doneIds: [...new Set(entries.filter((e) => !failed(e)).map((e) => e.elementId))].filter((id) => !activeIds.includes(id)),
      errorIds: [...new Set(entries.filter(failed).map((e) => e.elementId))],
    }
  }, [view, history])

  const short = instanceId.slice(0, 8)
  const instance = view?.instance

  return (
    <Box>
      <PageHeader title={`Instance ${short}`} group="Workflows / Instances" {...(instance ? { subtitle: `${instance.definitionId} v${instance.definitionVersion}` } : {})}>
        <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack}>
          Back to instances
        </Button>
      </PageHeader>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      {!view && !error && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading the instance" />
        </Box>
      )}

      {view && instance && (
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={3} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <InstanceStatusChip status={instance.status} />
            <Typography variant="body2">
              <Typography component="span" variant="body2" color="text.secondary">Started </Typography>
              {formatDate(instance.startedAt)}
            </Typography>
            {instance.completedAt && (
              <Typography variant="body2">
                <Typography component="span" variant="body2" color="text.secondary">Ended </Typography>
                {formatDate(instance.completedAt)}
              </Typography>
            )}
            {instance.businessKey && (
              <Typography variant="body2">
                <Typography component="span" variant="body2" color="text.secondary">Business key </Typography>
                {instance.businessKey}
              </Typography>
            )}
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }} color="text.secondary">
              {instance.id}
            </Typography>
          </Stack>

          {instance.errorInfo && <Alert severity="error">{instance.errorInfo.message ?? instance.errorInfo.code ?? 'The instance reported an error'}</Alert>}

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Diagram
            </Typography>
            {xml === null && <CircularProgress size={20} aria-label="Loading the diagram" />}
            {xml === 'unavailable' && <Alert severity="info">The diagram is not available for this definition version. The timeline below still shows what happened.</Alert>}
            {diagramError && <Alert severity="warning">The diagram could not be drawn ({diagramError}). The timeline below still shows what happened.</Alert>}
            {xml !== null && xml !== 'unavailable' && !diagramError && (
              <DiagramBoundary fallback={<Alert severity="warning">The diagram could not be loaded. The timeline below still shows what happened.</Alert>}>
                <Suspense fallback={<CircularProgress size={20} aria-label="Loading the diagram" />}>
                  <BpmnDiagram xml={xml} {...marks} onError={onDiagramError} />
                </Suspense>
              </DiagramBoundary>
            )}
            <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
              <Typography variant="caption" sx={{ color: '#1e88e5' }}>● now</Typography>
              <Typography variant="caption" sx={{ color: '#43a047' }}>● passed</Typography>
              <Typography variant="caption" sx={{ color: '#e53935' }}>● cancelled or failed</Typography>
            </Stack>
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Where it is now
            </Typography>
            {view.tokens.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nowhere: the instance is not waiting at any element.
              </Typography>
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Element</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {view.tokens.map((token) => (
                    <TableRow key={token.id}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{token.elementId}</TableCell>
                      <TableCell>{token.elementType}</TableCell>
                      <TableCell>{token.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Variables
            </Typography>
            {Object.keys(view.variables).length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No variables.
              </Typography>
            ) : (
              <Table>
                <TableBody>
                  {Object.entries(view.variables).map(([name, value]) => (
                    <TableRow key={name}>
                      <TableCell sx={{ fontFamily: 'monospace', width: '30%' }}>{name}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{JSON.stringify(value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Timeline
            </Typography>
            {(history ?? []).length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing has finished yet.
              </Typography>
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Started</TableCell>
                    <TableCell>Element</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Result</TableCell>
                    <TableCell align="right">Took</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(history ?? []).map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{formatDate(entry.startedAt)}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{entry.elementId}</TableCell>
                      <TableCell>{entry.elementType}</TableCell>
                      <TableCell>{entry.status}</TableCell>
                      <TableCell align="right">{duration(entry)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>
        </Stack>
      )}
    </Box>
  )
}
