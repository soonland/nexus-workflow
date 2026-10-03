import { useState } from 'react'
import { Box, CircularProgress, CssBaseline, ThemeProvider, Typography } from '@mui/material'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { AppShell, type Screen } from './components/AppShell'
import { theme } from './theme'
import { useTenantContext } from './auth/TenantContext'
import { canManageUsers, describeSession, isOperator } from './auth/roles'
import { InvitePage, readInviteToken } from './pages/InvitePage'
import { LoginPage } from './pages/LoginPage'
import { DefinitionsPage } from './pages/DefinitionsPage'
import { InstancesPage } from './pages/InstancesPage'
import { TasksPage } from './pages/TasksPage'
import { WebhooksPage } from './pages/WebhooksPage'
import { TenantsPage } from './pages/TenantsPage'
import { UsersPage } from './pages/UsersPage'

function Shell() {
  const { api, session, loading, signOut } = useAuth()
  // The token is read once and then removed from the address bar: the link is a secret, so it
  // should not stay in the history or get copied from the URL by accident.
  const [inviteToken, setInviteToken] = useState(() => {
    const token = readInviteToken(window.location.pathname)
    if (token) window.history.replaceState(null, '', '/console/')
    return token
  })
  const [chosen, setChosen] = useState<Screen | null>(null)
  const tenant = useTenantContext()

  if (inviteToken) return <InvitePage token={inviteToken} onDone={() => setInviteToken(null)} />
  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Checking your session" />
      </Box>
    )
  }
  if (!session) return <LoginPage />

  const screens: Screen[] = [...(tenant.tenantId ? (['definitions', 'instances', 'tasks', 'webhooks'] as const) : []), ...(isOperator(session) ? (['tenants'] as const) : []), ...(canManageUsers(session) ? (['users'] as const) : [])]
  const screen = chosen && screens.includes(chosen) ? chosen : screens[0]

  return (
    <AppShell
      screens={screens}
      screen={screen}
      onSelect={setChosen}
      tenantId={tenant.tenantId}
      tenantIds={tenant.tenantIds}
      onSelectTenant={tenant.select}
      who={describeSession(session)}
      onSignOut={() => void signOut()}
    >
      {screen === 'definitions' && tenant.api && tenant.tenantId && <DefinitionsPage key={tenant.tenantId} api={tenant.api} tenantId={tenant.tenantId} />}
      {screen === 'instances' && tenant.api && tenant.tenantId && <InstancesPage key={tenant.tenantId} api={tenant.api} tenantId={tenant.tenantId} />}
      {screen === 'tasks' && tenant.api && tenant.tenantId && (
        <TasksPage key={tenant.tenantId} api={tenant.api} tenantId={tenant.tenantId} actor={session.kind === 'user' ? session.user.email : describeSession(session)} />
      )}
      {screen === 'webhooks' && tenant.api && tenant.tenantId && <WebhooksPage key={tenant.tenantId} api={tenant.api} tenantId={tenant.tenantId} />}
      {screen === 'tenants' && <TenantsPage api={api} />}
      {screen === 'users' && <UsersPage api={api} session={session} />}
      {screen === undefined && <Typography color="text.secondary">Your account has no roles yet. Ask an operator to give you access.</Typography>}
    </AppShell>
  )
}

export function App({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  return (
    <AuthProvider {...(fetchImpl ? { fetchImpl } : {})}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Shell />
      </ThemeProvider>
    </AuthProvider>
  )
}
