import { auth } from '@/auth'
import { notFound, redirect } from 'next/navigation'
import { db } from '@/db/client'
import SubmitButton from './SubmitButton'

export default async function TimesheetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const { id } = await params

  const ts = await db.timesheet.findUnique({
    where: { id },
    include: { employee: { include: { user: { select: { email: true } } } } },
  })
  if (!ts) notFound()

  // Only the employee who owns it (or a manager) can view
  if (
    session?.user.role !== 'manager' &&
    ts.employeeId !== session?.user.employeeId
  ) {
    redirect('/dashboard')
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    submitted: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Timesheet Detail</h1>
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <dl className="space-y-3">
          {[
            { label: 'Employee', value: ts.employee.user.email },
            { label: 'Week Start', value: ts.weekStart.toISOString().split('T')[0] },
            { label: 'Total Hours', value: `${ts.totalHours}h` },
            { label: 'Notes', value: ts.notes ?? '-' },
            { label: 'Submitted', value: ts.submittedAt?.toISOString() ?? '-' },
            { label: 'Decided', value: ts.decidedAt?.toISOString() ?? '-' },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-sm text-gray-500">{label}</dt>
              <dd className="text-sm font-medium text-gray-900">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-sm text-gray-500">Status</dt>
            <dd className="mt-1">
              <span className={`px-2 py-1 text-xs rounded ${statusColors[ts.status] ?? ''}`}>
                {ts.status}
              </span>
            </dd>
          </div>
        </dl>
        {ts.status === 'draft' && ts.employeeId === session?.user.employeeId && (
          <SubmitButton timesheetId={ts.id} />
        )}
      </div>
    </div>
  )
}
