import type { Metadata } from 'next'
import './globals.css'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-js.css'
import { auth } from '@/auth'
import ThemeRegistry from '@/components/ThemeRegistry'

export const metadata: Metadata = {
  title: 'Nexus ERP',
  description: 'Employee management and timesheet approval',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const initialTheme = session?.user?.theme ?? 'system'

  return (
    <html lang="en">
      <head>
        {/* Blocking script: apply theme from localStorage before React hydration to prevent FOUT */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('nexus-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <ThemeRegistry initialTheme={initialTheme}>{children}</ThemeRegistry>
      </body>
    </html>
  )
}
