import { useState, type FormEvent } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { ApiError, type TenantApi } from '../api/client'
import type { InstanceToken } from '../api/types'
import type { ForceChoice } from '../forceActions'
import { parseJsonObject } from '../jsonObject'

const MAX_REASON = 500

interface Props {
  /** The step and what to do to it; the dialog is open while this is set. */
  target: { token: InstanceToken; choice: ForceChoice } | null
  instanceId: string
  api: TenantApi
  onClose(): void
  /** The step was pushed along (or turned out no longer to be waiting: either way the page should reload). */
  onDone(outcome: 'forced' | 'moved-on'): void
}

/** Asks for the reason, says what will happen and who will be told, then pushes the step along. */
export function ForceStepDialog({ target: requested, instanceId, api, onClose, onDone }: Props) {
  // The dialog fades out after `requested` goes null; keep the last target so its title and buttons
  // do not blank while it does
  const [lastTarget, setLastTarget] = useState(requested)
  if (requested !== null && requested !== lastTarget) setLastTarget(requested)
  const target = requested ?? lastTarget
  const [reason, setReason] = useState('')
  const [variables, setVariables] = useState('')
  const [variablesError, setVariablesError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moved, setMoved] = useState(false)
  const [busy, setBusy] = useState(false)

  function reset() {
    setReason('')
    setVariables('')
    setVariablesError(null)
    setError(null)
    setMoved(false)
    setBusy(false)
  }

  function close() {
    if (busy) return // a request is in flight: its answer must land in a dialog that is still open
    const wasMoved = moved
    reset()
    if (wasMoved) onDone('moved-on')
    else onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!target) return
    const parsed = target.choice.takesVariables ? parseJsonObject(variables) : { ok: true as const, value: undefined }
    if (!parsed.ok) {
      setVariablesError('The output variables must be a JSON object, for example {"approved": true}.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.forceStep(instanceId, {
        action: target.choice.action,
        tokenId: target.token.id,
        reason: reason.trim(),
        ...(parsed.value ? { outputVariables: parsed.value } : {}),
      })
      reset()
      onDone('forced')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_NOT_CURRENT') {
        // Someone (or the instance itself) got there first: nothing was done, and the page should show where it is now
        setMoved(true)
        setError('This step is no longer waiting: the instance has moved on. Nothing was changed.')
      } else {
        setError(err instanceof Error ? err.message : 'The step could not be pushed along')
      }
      setBusy(false)
    }
  }

  const trimmed = reason.trim()

  return (
    <Dialog open={requested !== null} onClose={close} fullWidth maxWidth="sm">
      <form onSubmit={submit}>
        <DialogTitle>{target?.choice.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">
              Step <strong>{target?.token.elementId}</strong>. {target?.choice.effect}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              The reason you give is kept with the step, in the instance's event log, and in the audit log under your name.
            </Typography>
            {error && <Alert severity={moved ? 'info' : 'error'}>{error}</Alert>}
            <TextField
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              autoFocus
              multiline
              minRows={2}
              disabled={moved}
              error={trimmed.length > MAX_REASON}
              helperText={`${trimmed.length} / ${MAX_REASON}`}
            />
            {target?.choice.takesVariables && (
              <TextField
                label="Output variables (JSON, optional)"
                value={variables}
                onChange={(e) => {
                  setVariables(e.target.value)
                  setVariablesError(null)
                }}
                error={variablesError !== null}
                helperText={variablesError ?? 'Handed to the workflow, e.g. {"approved": true}'}
                multiline
                minRows={2}
                disabled={moved}
                slotProps={{ htmlInput: { spellCheck: false } }}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={close}>
            {moved ? 'Close' : 'Cancel'}
          </Button>
          {!moved && (
            <Button
              type="submit"
              variant="contained"
              color={target?.choice.destructive ? 'error' : 'primary'}
              disabled={busy || trimmed === '' || trimmed.length > MAX_REASON}
            >
              {busy ? 'Working…' : target?.choice.label}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  )
}
