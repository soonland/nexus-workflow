import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import Link from 'next/link'

export default async function TimesheetsPage() {
  const session = await auth()
  if (!session?.user.employeeId) redirect('/dashboard')

  const timesheets = await db.timesheet.findMany({
    where: { employeeId: session.user.employeeId },
    orderBy: { weekStart: 'desc' },
  })

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    submitted: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Timesheets</h1>
        <Link
          href="/timesheets/new"
          className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
        >
          New Timesheet
        </Link>
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {timesheets.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No timesheets yet. Create your first one!</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Week Start', 'Hours', 'Notes', 'Status', ''].map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {timesheets.map((ts) => (
                <tr key={ts.id}>
                  <td className="px-6 py-4 text-sm text-gray-900">{ts.weekStart.toISOString().split('T')[0]}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{ts.totalHours.toString()}h</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{ts.notes ?? '-'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded ${statusColors[ts.status] ?? ''}`}>
                      {ts.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <Link href={`/timesheets/${ts.id}`} className="text-indigo-600 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
