import type { Metadata } from 'next'
import './globals.css'
import ThemeRegistry from '@/components/ThemeRegistry'

export const metadata: Metadata = {
  title: 'Nexus ERP',
  description: 'Employee management and timesheet approval',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  )
}
