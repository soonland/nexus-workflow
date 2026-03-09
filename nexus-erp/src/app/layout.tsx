import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nexus ERP',
  description: 'Employee management and timesheet approval',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
