import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { signOut } from '@/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-8">
              <span className="text-xl font-bold text-indigo-600">Nexus ERP</span>
              <Link href="/dashboard" className="text-gray-700 hover:text-indigo-600 text-sm font-medium">
                Dashboard
              </Link>
              <Link href="/timesheets" className="text-gray-700 hover:text-indigo-600 text-sm font-medium">
                Timesheets
              </Link>
              {session.user.role === 'manager' && (
                <>
                  <Link href="/employees" className="text-gray-700 hover:text-indigo-600 text-sm font-medium">
                    Employees
                  </Link>
                  <Link href="/tasks" className="text-gray-700 hover:text-indigo-600 text-sm font-medium">
                    Task Inbox
                  </Link>
                </>
              )}
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">{session.user.email}</span>
              <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded">
                {session.user.role}
              </span>
              <form
                action={async () => {
                  'use server'
                  await signOut({ redirectTo: '/login' })
                }}
              >
                <button type="submit" className="text-sm text-gray-500 hover:text-gray-700">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  )
}
