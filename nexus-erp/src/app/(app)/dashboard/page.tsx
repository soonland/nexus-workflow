import { auth } from '@/auth'
import { db } from '@/db/client'
import Link from 'next/link'

export default async function DashboardPage() {
  const session = await auth()
  const isManager = session?.user.role === 'manager'

  const [timesheetCount, submittedCount] = await Promise.all([
    session?.user.employeeId
      ? db.timesheet.count({ where: { employeeId: session.user.employeeId } })
      : Promise.resolve(0),
    session?.user.employeeId
      ? db.timesheet.count({ where: { employeeId: session.user.employeeId, status: 'submitted' } })
      : Promise.resolve(0),
  ])

  let pendingTaskCount = 0
  if (isManager) {
    const res = await fetch(
      `${process.env.WORKFLOW_API_URL ?? 'http://localhost:3000'}/tasks?assignee=${session!.user.id}&status=open&pageSize=1`,
      { cache: 'no-store' },
    )
    if (res.ok) {
      const data = await res.json()
      pendingTaskCount = data.total ?? 0
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500">My Timesheets</h3>
          <p className="text-3xl font-bold text-gray-900 mt-2">{timesheetCount}</p>
          <Link href="/timesheets" className="text-indigo-600 text-sm mt-4 inline-block hover:underline">
            View all →
          </Link>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500">Pending Approval</h3>
          <p className="text-3xl font-bold text-yellow-600 mt-2">{submittedCount}</p>
        </div>
        {isManager && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-500">Tasks to Review</h3>
            <p className="text-3xl font-bold text-indigo-600 mt-2">{pendingTaskCount}</p>
            <Link href="/tasks" className="text-indigo-600 text-sm mt-4 inline-block hover:underline">
              Open inbox →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
