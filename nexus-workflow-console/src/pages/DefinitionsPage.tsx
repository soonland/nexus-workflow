import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type { TenantApi } from '../api/client'
import type { DefinitionSummary } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DeployDefinitionDialog } from '../components/DeployDefinitionDialog'
import { StartInstanceDialog } from '../components/StartInstanceDialog'
import { PageHeader } from '../components/PageHeader'
import { ListFooter, ListToolbar, SortHeader } from '../list/ListControls'
import { useListView } from '../list/useListView'
import { formatDate } from '../format'

// What the search looks in, and what each sortable column sorts by (module level: stable between renders)
const definitionText = (d: DefinitionSummary) => `${d.name} ${d.id} v${d.version}`
const definitionSort = {
  name: (d: DefinitionSummary) => d.name || d.id,
  version: (d: DefinitionSummary) => d.version,
  deployed: (d: DefinitionSummary) => d.deployedAt,
}

export function DefinitionsPage({ api, tenantId }: { api: TenantApi; tenantId: string }) {
  const [definitions, setDefinitions] = useState<DefinitionSummary[] | null>(null)
  const view = useListView(definitions, { searchText: definitionText, sortValues: definitionSort })
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const [deleting, setDeleting] = useState<DefinitionSummary | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [starting, setStarting] = useState<DefinitionSummary | null>(null)

  // Answers can arrive out of order; only the newest request may update the screen
  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latestRequest.current
    try {
      const loaded = await api.listDefinitions()
      if (request !== latestRequest.current) return
      setDefinitions(loaded)
      setError(null)
    } catch (err) {
      if (request !== latestRequest.current) return
      setError(err instanceof Error ? err.message : 'Could not load the definitions')
    }
  }, [api])

  useEffect(() => {
    setDefinitions(null)
    void load()
  }, [load])

  async function remove(definition: DefinitionSummary) {
    try {
      await api.deleteDefinition(definition.id)
      setMessage({ severity: 'success', text: `Deleted ${definition.id}` })
    } catch (err) {
      setMessage({ severity: 'error', text: err instanceof Error ? err.message : 'The delete failed' })
    }
    await load()
  }

  // The API starts the latest version of a definition, so that is the row that offers "Start"
  const latestVersion = new Map<string, number>()
  for (const d of definitions ?? []) latestVersion.set(d.id, Math.max(d.version, latestVersion.get(d.id) ?? 0))

  return (
    <Box>
      <PageHeader title="Definitions" group="Workflows" subtitle={`Workflows deployed in ${tenantId}`}>
        <Tooltip title="Refresh">
          <IconButton aria-label="Refresh" onClick={() => void load()}>
            <RefreshRoundedIcon />
          </IconButton>
        </Tooltip>
        <Button variant="contained" startIcon={<CloudUploadRoundedIcon />} onClick={() => setDeploying(true)}>
          Deploy definition
        </Button>
      </PageHeader>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      {definitions === null && !error ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading definitions" />
        </Box>
      ) : (
        <>
          <ListToolbar pageSize={view.pageSize} onPageSize={view.setPageSize} query={view.query} onQuery={view.setQuery} searchLabel="Search definitions" />
          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Table>
            <TableHead>
              <TableRow>
                <SortHeader label="Definition" sortKey="name" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Version" sortKey="version" align="right" sort={view.sort} onSort={view.toggleSort} />
                <SortHeader label="Deployed" sortKey="deployed" sort={view.sort} onSort={view.toggleSort} />
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {view.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    {view.query.trim() !== '' ? 'Nothing matches your search' : 'No definitions deployed yet'}
                  </TableCell>
                </TableRow>
              )}
              {view.rows.map((definition) => (
                <TableRow key={`${definition.id}@${definition.version}`} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600 }}>{definition.name || definition.id}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {definition.id}
                    </Typography>{' '}
                    {!definition.isDeployable && <Chip size="small" variant="outlined" label="not startable" />}
                  </TableCell>
                  <TableCell align="right">{definition.version}</TableCell>
                  <TableCell>{formatDate(definition.deployedAt)}</TableCell>
                  <TableCell align="right">
                    {/* Starting uses the latest version, so offer it on that row only (and not for definitions that cannot be started) */}
                    {definition.isDeployable && definition.version === latestVersion.get(definition.id) && (
                      <Button size="small" startIcon={<PlayArrowRoundedIcon />} onClick={() => setStarting(definition)} aria-label={`Start ${definition.id}`}>
                        Start
                      </Button>
                    )}
                    {/* Deleting removes every version, so offer it once per definition: on the latest version's row, like Start */}
                    {definition.version === latestVersion.get(definition.id) && (
                      <Tooltip title="Delete all versions">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeleting(definition)}
                          aria-label={`Delete all versions of ${definition.id}`}
                        >
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListFooter page={view.page} onPage={view.setPage} pageSize={view.pageSize} filteredCount={view.filteredCount} totalCount={view.totalCount} />
        </TableContainer>
        </>
      )}

      <DeployDefinitionDialog
        open={deploying}
        api={api}
        onClose={() => setDeploying(false)}
        onDeployed={(result) => {
          setDeploying(false)
          setMessage({ severity: 'success', text: `Deployed ${result.id} v${result.version}` })
          void load()
        }}
      />

      <StartInstanceDialog
        definition={starting}
        api={api}
        onClose={() => setStarting(null)}
        onStarted={(instanceId, definition) => {
          setStarting(null)
          setMessage({ severity: 'success', text: `Started instance ${instanceId.slice(0, 8)} of ${definition.id}` })
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this definition?"
        confirmLabel="Delete definition"
        requireText={deleting?.id}
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const definition = deleting
          setDeleting(null)
          if (definition) void remove(definition)
        }}
      >
        This deletes <strong>every version</strong> of <strong>{deleting?.id}</strong>. It is refused while the definition has
        pending, active or suspended instances.
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
