import * as React from 'react'
import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import { auth } from '@/auth'
import AppSidebar from '@/components/AppSidebar'
import TopBar from '@/components/TopBar'
import { SidebarProvider } from '@/components/SidebarContext'
import { SnackbarProvider } from '@/components/SnackbarContext'
import { signOutAction } from '@/lib/actions'

const AppLayout = async ({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) => {
  const [session, { locale }] = await Promise.all([auth(), params])
  if (!session) redirect(`/${locale}/login`)

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
              employeeId={session.user.employeeId ?? null}
              role={session.user.role}
              signOutAction={signOutAction}
              userId={session.user.id}
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
export default AppLayout
