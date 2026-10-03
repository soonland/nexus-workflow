import { useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import { ApiError, type TenantApi } from '../api/client'
import type { DeployResult } from '../api/types'

/** The server refuses bigger definitions; say so before sending a megabyte for nothing. */
const MAX_BYTES = 1024 * 1024

const warningText = (w: DeployResult['validationWarnings'][number]) => (typeof w === 'string' ? w : (w.message ?? 'Warning'))

interface Props {
  open: boolean
  api: TenantApi
  onClose(): void
  /** The definition was deployed and the person has seen the result. */
  onDeployed(result: DeployResult): void
}

export function DeployDefinitionDialog({ open, api, onClose, onDeployed }: Props) {
  const [xml, setXml] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DeployResult | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  function reset() {
    setXml('')
    setFileName(null)
    setError(null)
    setBusy(false)
    setResult(null)
  }

  function close() {
    const done = result
    reset()
    if (done) onDeployed(done)
    else onClose()
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      setXml(await file.text())
      setFileName(file.name)
    } catch {
      setError({ message: 'That file could not be read.', details: [] })
    }
  }

  async function deploy() {
    if (new Blob([xml]).size > MAX_BYTES) {
      setError({ message: 'The definition is larger than 1 MB, which the server does not accept.', details: [] })
      return
    }
    setBusy(true)
    setError(null)
    try {
      setResult(await api.deployDefinition(xml))
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'The definition could not be deployed', details: err instanceof ApiError ? err.details : [] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md">
      <DialogTitle>Deploy a definition</DialogTitle>
      <DialogContent>
        {result ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="success">
              Deployed <strong>{result.id}</strong> as version {result.version}.
            </Alert>
            {result.validationWarnings.length > 0 && (
              <Alert severity="warning">
                The definition was accepted, with {result.validationWarnings.length === 1 ? 'a warning' : `${result.validationWarnings.length} warnings`}:
                <List dense disablePadding>
                  {result.validationWarnings.map((warning, index) => (
                    <ListItem key={index} disableGutters>
                      <ListItemText primary={warningText(warning)} />
                    </ListItem>
                  ))}
                </List>
              </Alert>
            )}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && (
              <Alert severity="error">
                {error.message}
                {error.details.length > 0 && (
                  <List dense disablePadding>
                    {error.details.map((line, index) => (
                      <ListItem key={index} disableGutters>
                        <ListItemText primary={line} />
                      </ListItem>
                    ))}
                  </List>
                )}
              </Alert>
            )}
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <input
                ref={fileInput}
                type="file"
                accept=".bpmn,.xml,application/xml,text/xml"
                hidden
                data-testid="definition-file"
                onChange={(e) => {
                  void chooseFile(e.target.files?.[0])
                  e.target.value = '' // choosing the same file again should work
                }}
              />
              <Button variant="outlined" startIcon={<UploadFileRoundedIcon />} onClick={() => fileInput.current?.click()}>
                Choose a file
              </Button>
              <Typography variant="body2" color="text.secondary">
                {fileName ?? 'or paste the BPMN XML below'}
              </Typography>
            </Stack>
            <TextField
              label="BPMN XML"
              value={xml}
              onChange={(e) => {
                setXml(e.target.value)
                setFileName(null)
              }}
              multiline
              minRows={10}
              maxRows={18}
              fullWidth
              slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'monospace', fontSize: '0.8rem' } } }}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {result ? (
          <Button variant="contained" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="contained" disabled={busy || xml.trim() === ''} onClick={() => void deploy()}>
              {busy ? 'Deploying…' : 'Deploy'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
