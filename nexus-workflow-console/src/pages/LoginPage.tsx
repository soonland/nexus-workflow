import { useState, type FormEvent } from 'react'
import { Alert, Box, Button, Link, Paper, TextField, Typography } from '@mui/material'
import { useAuth } from '../auth/AuthContext'

export function LoginPage() {
  const { signInWithPassword, signInWithAdminKey, signedOutReason } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [key, setKey] = useState('')
  const [useKey, setUseKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (useKey) await signInWithAdminKey(key.trim())
      else await signInWithPassword(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  const ready = useKey ? key.trim() !== '' : email.trim() !== '' && password !== ''

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper component="form" onSubmit={submit} sx={{ p: 4, width: '100%', maxWidth: 420 }} elevation={2}>
        <Typography variant="h5" component="h1" gutterBottom>
          Nexus Workflow Console
        </Typography>
        {signedOutReason && !error && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {signedOutReason}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {useKey ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Break-glass access with the platform admin key (<code>ADMIN_API_KEY</code> of nexus-workflow-app). It is
              kept in this browser tab only.
            </Typography>
            <TextField
              label="Admin key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoFocus
              fullWidth
              required
              autoComplete="off"
            />
          </>
        ) : (
          <>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              fullWidth
              required
              autoComplete="username"
              sx={{ mb: 2 }}
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              required
              autoComplete="current-password"
            />
          </>
        )}
        <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={busy || !ready}>
          {busy ? 'Checking…' : 'Sign in'}
        </Button>
        <Typography variant="body2" sx={{ mt: 2, textAlign: 'center' }}>
          <Link
            component="button"
            type="button"
            onClick={() => {
              setUseKey(!useKey)
              setError(null)
            }}
          >
            {useKey ? 'Sign in with email and password' : 'Advanced: use the admin key'}
          </Link>
        </Typography>
      </Paper>
    </Box>
  )
}
