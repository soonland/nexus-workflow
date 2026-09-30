import { useState, type FormEvent } from 'react'
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material'
import { useAuth } from '../auth/AuthContext'

export function LoginPage() {
  const { signIn } = useAuth()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(key.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper component="form" onSubmit={submit} sx={{ p: 4, width: '100%', maxWidth: 420 }} elevation={2}>
        <Typography variant="h5" component="h1" gutterBottom>
          Nexus Workflow Console
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Sign in with the platform admin key (<code>ADMIN_API_KEY</code> of nexus-workflow-app). It is kept in this
          browser tab only.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
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
        <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={busy || key.trim() === ''}>
          {busy ? 'Checking…' : 'Sign in'}
        </Button>
      </Paper>
    </Box>
  )
}
