import { Component, Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type { TenantApi } from '../api/client'
import type { HistoryEntry, InstanceEvent, InstanceToken, InstanceView } from '../api/types'
import { describeEvent, historyMarks, progressMarks } from '../instanceEvents'
import { ForceStepDialog } from '../components/ForceStepDialog'
import { describeForcedAction, forceChoices, type ForceChoice } from '../forceActions'
import { InstanceStatusChip } from '../components/InstanceStatusChip'
import { MARK_COLORS } from '../components/diagramMarks'
import { PageHeader } from '../components/PageHeader'
import { formatDate, formatDuration } from '../format'

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

/** The event log as a table: what happened, when, and at which element. */
function EventsTable({ events }: { events: InstanceEvent[] }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Time</TableCell>
          <TableCell>What happened</TableCell>
          <TableCell>Element</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {events.map((event) => {
          const { summary, elementId } = describeEvent(event)
          return (
            <TableRow key={event.id}>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(event.occurredAt)}</TableCell>
              <TableCell>{summary}</TableCell>
              <TableCell sx={{ fontFamily: 'monospace' }}>{elementId ?? ''}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function InstanceDetailPage({ api, instanceId, onBack }: { api: TenantApi; instanceId: string; onBack(): void }) {
  const [view, setView] = useState<InstanceView | null>(null)
  const [events, setEvents] = useState<InstanceEvent[] | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [openStep, setOpenStep] = useState<string | null>(null)
  const [forcing, setForcing] = useState<{ token: InstanceToken; choice: ForceChoice } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [xml, setXml] = useState<string | null | 'unavailable'>(null)
  const [error, setError] = useState<string | null>(null)
  const [diagramError, setDiagramError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [loaded, log, steps] = await Promise.all([
        api.getInstance(instanceId),
        api.getInstanceEvents(instanceId),
        // Step history is the richer record, but the page works from the event log without it
        api.getInstanceHistory(instanceId).catch((): HistoryEntry[] => []),
      ])
      setView(loaded)
      setEvents(log)
      setHistory(steps)
      setError(null)
      // Try the diagram again after an earlier failure. The drawing that is showing stays until the
      // XML arrives (and is not redrawn if it is the same), so a refresh keeps the reader's zoom.
      setDiagramError(null)
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
  // Instances that predate step history have none: they are marked from the event log instead
  const marks = useMemo(
    () => (history.length > 0 ? historyMarks(history, view?.tokens ?? []) : progressMarks(events ?? [], view?.tokens ?? [])),
    [view, events, history],
  )

  const short = instanceId.slice(0, 8)
  const instance = view?.instance

  return (
    <Box>
      <PageHeader title={`Instance ${short}`} group="Workflows / Instances" {...(instance ? { subtitle: `${instance.definitionId} v${instance.definitionVersion}` } : {})}>
        <Tooltip title="Refresh">
          <IconButton aria-label="Refresh" onClick={() => void load()}>
            <RefreshRoundedIcon />
          </IconButton>
        </Tooltip>
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
            {xml === 'unavailable' && <Alert severity="info">The diagram is not available for this definition version. The history below still shows what happened.</Alert>}
            {diagramError && <Alert severity="warning">The diagram could not be drawn ({diagramError}). The history below still shows what happened.</Alert>}
            {xml !== null && xml !== 'unavailable' && !diagramError && (
              <DiagramBoundary fallback={<Alert severity="warning">The diagram could not be loaded. The history below still shows what happened.</Alert>}>
                <Suspense fallback={<CircularProgress size={20} aria-label="Loading the diagram" />}>
                  <BpmnDiagram xml={xml} {...marks} onError={onDiagramError} />
                </Suspense>
              </DiagramBoundary>
            )}
            <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
              <Typography variant="caption" sx={{ color: `${MARK_COLORS.active}.main` }}>● now</Typography>
              <Typography variant="caption" sx={{ color: `${MARK_COLORS.done}.main` }}>● passed</Typography>
              <Typography variant="caption" sx={{ color: `${MARK_COLORS.error}.main` }}>● cancelled or failed</Typography>
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
                    <TableCell align="right">Push along</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {view.tokens.map((token) => (
                    <TableRow key={token.id}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{token.elementId}</TableCell>
                      <TableCell>{token.elementType}</TableCell>
                      <TableCell>{token.status}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                          {forceChoices(token).map((choice) => (
                            <Button
                              key={choice.action}
                              size="small"
                              color={choice.destructive ? 'error' : 'primary'}
                              aria-label={`${choice.label}: ${token.elementId}`}
                              onClick={() => setForcing({ token, choice })}
                            >
                              {choice.label}
                            </Button>
                          ))}
                        </Stack>
                      </TableCell>
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
              History
            </Typography>
            {history.length > 0 ? (
              <>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" />
                      <TableCell>Started</TableCell>
                      <TableCell>Step</TableCell>
                      <TableCell>Result</TableCell>
                      <TableCell align="right">Took</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {history.map((step) => {
                      const variables = Object.entries(step.variablesSnapshot ?? {})
                      const open = openStep === step.id
                      return (
                        <Fragment key={step.id}>
                          <TableRow hover>
                            <TableCell padding="checkbox">
                              {variables.length > 0 && (
                                <IconButton
                                  size="small"
                                  aria-label={`${open ? 'Hide' : 'Show'} the variables at ${step.elementId}`}
                                  aria-expanded={open}
                                  onClick={() => setOpenStep(open ? null : step.id)}
                                >
                                  {open ? <KeyboardArrowDownRoundedIcon fontSize="small" /> : <KeyboardArrowRightRoundedIcon fontSize="small" />}
                                </IconButton>
                              )}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(step.startedAt)}</TableCell>
                            <TableCell>
                              <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
                                {step.elementId}
                              </Typography>{' '}
                              <Typography component="span" variant="caption" color="text.secondary">
                                {step.elementType}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={step.status}
                                color={step.status === 'completed' ? 'success' : step.status === 'error' ? 'error' : 'warning'}
                                variant="outlined"
                              />
                              {step.forced && <Chip size="small" label="forced" color="info" sx={{ ml: 0.5 }} />}
                              {step.forced && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  {step.forced.by} {describeForcedAction(step.forced.action)}
                                  {step.forced.onBehalfOf ? ` for ${step.forced.onBehalfOf}` : ''}: “{step.forced.reason}”
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell align="right">{formatDuration(new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime())}</TableCell>
                          </TableRow>
                          {variables.length > 0 && (
                            <TableRow>
                              <TableCell colSpan={5} sx={{ py: 0, borderBottom: open ? undefined : 0 }}>
                                <Collapse in={open} unmountOnExit>
                                  <Table aria-label={`Variables at ${step.elementId}`}>
                                    <TableBody>
                                      {variables.map(([name, variable]) => (
                                        <TableRow key={name}>
                                          <TableCell sx={{ fontFamily: 'monospace', width: '30%' }}>{name}</TableCell>
                                          <TableCell sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{JSON.stringify(variable.value)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </Collapse>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
                {(events ?? []).length > 0 && (
                  <Accordion disableGutters variant="outlined" sx={{ mt: 1.5 }}>
                    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                      <Typography variant="body2">Event log ({(events ?? []).length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <EventsTable events={events ?? []} />
                    </AccordionDetails>
                  </Accordion>
                )}
              </>
            ) : (
              <>
            {(events ?? []).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nothing has been recorded yet.
                </Typography>
              ) : (
                <EventsTable events={events ?? []} />
              )}
              </>
            )}
          </Box>
        </Stack>
      )}

      <ForceStepDialog
        target={forcing}
        instanceId={instanceId}
        api={api}
        onClose={() => setForcing(null)}
        onDone={(outcome) => {
          setForcing(null)
          setMessage(outcome === 'forced' ? 'The step was pushed along' : 'The instance had already moved on: nothing was changed')
          void load()
        }}
      />

      <Snackbar
        open={message !== null}
        autoHideDuration={5000}
        onClose={() => setMessage(null)}
        message={message ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  )
}
