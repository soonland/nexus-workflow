import { useEffect, useState, type FormEvent } from 'react'
import { Alert, Box, Button, CircularProgress, Paper, TextField, Typography } from '@mui/material'
import type { InviteInfo } from '../api/types'
import { useAuth } from '../auth/AuthContext'

/** `/console/invite/<token>` → the token, otherwise null. */
export function readInviteToken(pathname: string): string | null {
  const match = /^\/console\/invite\/([^/]+)\/?$/.exec(pathname)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

/** An invited person chooses their password. The link works once and signs them in. */
export function InvitePage({ token, onDone }: { token: string; onDone: () => void }) {
  const { api, completeInvite } = useAuth()
  const [info, setInfo] = useState<InviteInfo | 'invalid' | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .inviteInfo(token)
      .then((found) => {
        if (!cancelled) setInfo(found)
      })
      .catch(() => {
        if (!cancelled) setInfo('invalid')
      })
    return () => {
      cancelled = true
    }
  }, [api, token])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await completeInvite(token, password)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the password')
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper component="form" onSubmit={submit} sx={{ p: 4, width: '100%', maxWidth: 420 }} elevation={2}>
        <Typography variant="h5" component="h1" gutterBottom>
          Welcome to Nexus Workflow
        </Typography>
        {info === null && <CircularProgress aria-label="Checking the invitation" />}
        {info === 'invalid' && (
          <>
            <Alert severity="error" sx={{ mb: 2 }}>
              This invitation link is invalid or has expired. Ask the person who invited you for a new one.
            </Alert>
            <Button fullWidth onClick={onDone}>
              Go to sign-in
            </Button>
          </>
        )}
        {info !== null && info !== 'invalid' && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Hello {info.name}. Choose a password for <strong>{info.email}</strong> to finish setting up your account.
            </Typography>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <TextField
              label="New password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              fullWidth
              required
              autoComplete="new-password"
              sx={{ mb: 2 }}
            />
            <TextField
              label="Repeat the password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              fullWidth
              required
              autoComplete="new-password"
            />
            <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={busy || password === ''}>
              {busy ? 'Saving…' : 'Set password and sign in'}
            </Button>
          </>
        )}
      </Paper>
    </Box>
  )
}
