import type { Metadata } from 'next'
import './globals.css'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-js.css'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import ThemeRegistry from '@/components/ThemeRegistry'

export const metadata: Metadata = {
  title: 'Nexus ERP',
  description: 'Employee management and timesheet approval',
}

const RootLayout = async ({ children }: { children: React.ReactNode }) => {
  const [session, cookieStore] = await Promise.all([auth(), cookies()])
  const initialTheme =
    cookieStore.get('nexus-theme')?.value ?? session?.user?.theme ?? 'system'

  return (
    <html lang="en" data-theme={initialTheme}>
      <body>
        <ThemeRegistry initialTheme={initialTheme}>{children}</ThemeRegistry>
      </body>
    </html>
  )
}
export default RootLayout
