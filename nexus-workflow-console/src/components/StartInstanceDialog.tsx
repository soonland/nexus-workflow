import { useState, type FormEvent } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import type { TenantApi } from '../api/client'
import type { DefinitionSummary } from '../api/types'
import { parseJsonObject } from '../jsonObject'

interface Props {
  /** The definition to start; the dialog is open while this is set. */
  definition: DefinitionSummary | null
  api: TenantApi
  onClose(): void
  onStarted(instanceId: string, definition: DefinitionSummary): void
}

export function StartInstanceDialog({ definition, api, onClose, onStarted }: Props) {
  const [businessKey, setBusinessKey] = useState('')
  const [variables, setVariables] = useState('')
  const [variablesError, setVariablesError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function reset() {
    setBusinessKey('')
    setVariables('')
    setVariablesError(null)
    setError(null)
    setBusy(false)
  }

  function close() {
    if (busy) return // a request is in flight: do not dismiss, or onStarted would fire after the dialog is gone
    reset()
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!definition) return
    const parsed = parseJsonObject(variables)
    if (!parsed.ok) {
      setVariablesError('The variables must be a JSON object, for example {"amount": 120}.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const id = await api.startInstance(definition.id, {
        ...(businessKey.trim() ? { businessKey: businessKey.trim() } : {}),
        ...(parsed.value ? { variables: parsed.value } : {}),
      })
      reset()
      onStarted(id, definition)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The instance could not be started')
      setBusy(false)
    }
  }

  return (
    <Dialog open={definition !== null} onClose={close} fullWidth maxWidth="sm">
      <form onSubmit={submit}>
        <DialogTitle>Start {definition?.name || definition?.id}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Starts a new instance of the latest version of <strong>{definition?.id}</strong>.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Business key (optional)" value={businessKey} onChange={(e) => setBusinessKey(e.target.value)} helperText="Your own reference, e.g. an order number" autoFocus />
            <TextField
              label="Variables (JSON, optional)"
              value={variables}
              onChange={(e) => {
                setVariables(e.target.value)
                setVariablesError(null)
              }}
              error={variablesError !== null}
              helperText={variablesError ?? 'The workflow starts with these, e.g. {"amount": 120}'}
              multiline
              minRows={3}
              slotProps={{ htmlInput: { spellCheck: false } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Starting…' : 'Start instance'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
