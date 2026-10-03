import { useState, type FocusEvent } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import type { Invite } from '../api/types'
import { formatDate } from '../format'

/** The link to send, as an absolute address. The server only knows its own when PUBLIC_ORIGIN is set. */
export function inviteLink(invite: Invite): string {
  return invite.url ?? `${window.location.origin}${invite.path}`
}

/** Shows an invitation link once, with a copy button. The link is not kept anywhere afterwards. */
export function InviteLinkDialog({ invite, name, onClose }: { invite: Invite | null; name: string; onClose(): void }) {
  const [copied, setCopied] = useState(false)
  const link = invite ? inviteLink(invite) : ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false) // the field is selectable, so the link can still be copied by hand
    }
  }

  function close() {
    setCopied(false)
    onClose()
  }

  return (
    <Dialog open={invite !== null} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>Invitation for {name}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Send this link to {name}. It works once, and lets them choose their password
          {invite ? ` until ${formatDate(invite.expiresAt)}` : ''}. It is shown only now: close this and it is gone, but you can
          always issue a new one.
        </DialogContentText>
        <TextField
          label="Invitation link"
          value={link}
          fullWidth
          slotProps={{ input: { readOnly: true }, htmlInput: { onFocus: (e: FocusEvent<HTMLInputElement>) => e.currentTarget.select() } }}
        />
        {copied && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Copied to the clipboard
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button startIcon={<ContentCopyRoundedIcon />} onClick={() => void copy()}>
          Copy link
        </Button>
        <Button variant="contained" onClick={close}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}
