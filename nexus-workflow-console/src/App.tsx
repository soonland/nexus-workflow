import { AppBar, Box, Button, Container, CssBaseline, Toolbar, Typography } from '@mui/material'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { LoginPage } from './pages/LoginPage'
import { TenantsPage } from './pages/TenantsPage'

function Shell() {
  const { api, isSignedIn, signOut } = useAuth()
  if (!isSignedIn) return <LoginPage />

  return (
    <Box>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Nexus Workflow Console
          </Typography>
          <Button color="inherit" startIcon={<LogoutRoundedIcon />} onClick={signOut}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <TenantsPage api={api} />
      </Container>
    </Box>
  )
}

export function App({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  return (
    <AuthProvider {...(fetchImpl ? { fetchImpl } : {})}>
      <CssBaseline />
      <Shell />
    </AuthProvider>
  )
}
