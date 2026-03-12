import * as React from 'react'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import AppSidebar, { SIDEBAR_EXPANDED_WIDTH } from '@/components/AppSidebar'
import TopBar from '@/components/TopBar'
import { SidebarProvider } from '@/components/SidebarContext'
import { SnackbarProvider } from '@/components/SnackbarContext'
import { signOutAction } from '@/lib/actions'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  return (
    <SidebarProvider>
      <SnackbarProvider>
        <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}>
          <AppSidebar role={session.user.role} hasEmployee={!!session.user.employeeId} />

          <Box
            component="main"
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              pt: '64px',
              minWidth: 0,
            }}
          >
            <TopBar
              email={session.user.email ?? ''}
              role={session.user.role}
              employeeId={session.user.employeeId ?? null}
              signOutAction={signOutAction}
            />

            <Box sx={{ flex: 1, p: { xs: 2, sm: 3 }, overflowY: 'auto' }}>
              {children}
            </Box>
          </Box>
        </Box>
      </SnackbarProvider>
    </SidebarProvider>
  )
}
