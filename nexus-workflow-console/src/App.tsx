import { useState } from 'react'
import { AppBar, Box, Button, CircularProgress, Container, CssBaseline, MenuItem, Select, Tab, Tabs, Toolbar, Typography } from '@mui/material'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import { AuthProvider, useAuth } from './auth/AuthContext'
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

type Screen = 'definitions' | 'instances' | 'tasks' | 'webhooks' | 'tenants' | 'users'

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
    <Box>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ mr: 4 }}>
            Nexus Workflow Console
          </Typography>
          {screens.length > 1 && screen && (
            <Tabs value={screen} onChange={(_event, value: Screen) => setChosen(value)} sx={{ flexGrow: 1 }}>
              {screens.includes('definitions') && <Tab value="definitions" label="Definitions" />}
              {screens.includes('instances') && <Tab value="instances" label="Instances" />}
              {screens.includes('tasks') && <Tab value="tasks" label="Tasks" />}
              {screens.includes('webhooks') && <Tab value="webhooks" label="Webhooks" />}
              {screens.includes('tenants') && <Tab value="tenants" label="Tenants" />}
              {screens.includes('users') && <Tab value="users" label="Users" />}
            </Tabs>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {tenant.tenantId && (
            <Box sx={{ mr: 2 }}>
              {tenant.tenantIds.length > 1 ? (
                <Select
                  size="small"
                  value={tenant.tenantId}
                  onChange={(e) => tenant.select(e.target.value)}
                  slotProps={{ input: { 'aria-label': 'Tenant' } }}
                >
                  {tenant.tenantIds.map((id) => (
                    <MenuItem key={id} value={id}>
                      {id}
                    </MenuItem>
                  ))}
                </Select>
              ) : (
                <Typography variant="body2">Tenant: {tenant.tenantId}</Typography>
              )}
            </Box>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mr: 2 }}>
            {describeSession(session)}
          </Typography>
          <Button color="inherit" startIcon={<LogoutRoundedIcon />} onClick={() => void signOut()}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {screen === 'definitions' && tenant.api && tenant.tenantId && <DefinitionsPage key={tenant.tenantId} api={tenant.api} tenantId={tenant.tenantId} />}
        {screen === 'instances' && tenant.api && tenant.tenantId && <InstancesPage key={tenant.tenantId} api={tenant.api} tenantId={tenant.tenantId} />}
        {screen === 'tasks' && tenant.api && tenant.tenantId && (
          <TasksPage key={tenant.tenantId} api={tenant.api} tenantId={tenant.tenantId} actor={session.kind === 'user' ? session.user.email : describeSession(session)} />
        )}
        {screen === 'webhooks' && tenant.api && tenant.tenantId && <WebhooksPage key={tenant.tenantId} api={tenant.api} tenantId={tenant.tenantId} />}
        {screen === 'tenants' && <TenantsPage api={api} />}
        {screen === 'users' && <UsersPage api={api} session={session} />}
        {screen === undefined && (
          <Typography color="text.secondary">
            Your account has no roles yet. Ask an operator to give you access.
          </Typography>
        )}
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
