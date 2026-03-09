import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db/client'

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const { id } = await params
  const emp = await db.employee.findUnique({
    where: { id },
    include: {
      user: { select: { email: true, role: true } },
      manager: { select: { fullName: true } },
      timesheets: { orderBy: { weekStart: 'desc' }, take: 10 },
    },
  })
  if (!emp) notFound()

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{emp.fullName}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Profile</h2>
          <dl className="space-y-3">
            {[
              { label: 'Email', value: emp.user.email },
              { label: 'Department', value: emp.department },
              { label: 'Hire Date', value: emp.hireDate.toISOString().split('T')[0] },
              { label: 'Role', value: emp.user.role },
              { label: 'Manager', value: emp.manager?.fullName ?? 'None' },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt className="text-sm text-gray-500">{label}</dt>
                <dd className="text-sm font-medium text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Timesheets</h2>
          {emp.timesheets.length === 0 ? (
            <p className="text-sm text-gray-500">No timesheets yet.</p>
          ) : (
            <ul className="space-y-2">
              {emp.timesheets.map((ts) => (
                <li key={ts.id} className="flex justify-between text-sm">
                  <span>{ts.weekStart.toISOString().split('T')[0]}</span>
                  <span>{ts.totalHours.toString()}h</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    ts.status === 'approved' ? 'bg-green-100 text-green-800' :
                    ts.status === 'rejected' ? 'bg-red-100 text-red-800' :
                    ts.status === 'submitted' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>{ts.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
