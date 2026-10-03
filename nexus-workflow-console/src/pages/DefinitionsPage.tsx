import { useCallback, useEffect, useRef, useState } from 'react'
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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type { TenantApi } from '../api/client'
import type { DefinitionSummary } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { formatDate } from '../format'

export function DefinitionsPage({ api, tenantId }: { api: TenantApi; tenantId: string }) {
  const [definitions, setDefinitions] = useState<DefinitionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const [deleting, setDeleting] = useState<DefinitionSummary | null>(null)

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

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h5" component="h1">
            Definitions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Workflows deployed in {tenantId}
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton aria-label="Refresh" onClick={() => void load()}>
            <RefreshRoundedIcon />
          </IconButton>
        </Tooltip>
      </Stack>

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
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Definition</TableCell>
                <TableCell align="right">Version</TableCell>
                <TableCell>Deployed</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(definitions ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No definitions deployed yet
                  </TableCell>
                </TableRow>
              )}
              {(definitions ?? []).map((definition, index, all) => (
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
                    {/* Deleting removes every version, so offer it once per definition, not once per version row */}
                    {all.findIndex((other) => other.id === definition.id) === index && (
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
        </TableContainer>
      )}

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
