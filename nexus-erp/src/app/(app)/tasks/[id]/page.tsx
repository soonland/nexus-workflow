import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db/client'
import TaskDecisionForm from './TaskDecisionForm'

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const { id } = await params

  const BASE = process.env.WORKFLOW_API_URL ?? 'http://localhost:3000'
  const res = await fetch(`${BASE}/tasks/${id}`, { cache: 'no-store' })
  if (res.status === 404) notFound()
  if (!res.ok) throw new Error('Failed to load task')

  const { task, variables } = await res.json()

  // Look up the timesheet for context
  const timesheet = variables.timesheetId
    ? await db.timesheet.findUnique({
        where: { id: variables.timesheetId as string },
        include: { employee: { include: { user: { select: { email: true } } } } },
      })
    : null

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Review Task</h1>
      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-3">Task Details</h2>
          <dl className="space-y-2">
            <div>
              <dt className="text-sm text-gray-500">Task</dt>
              <dd className="text-sm font-medium text-gray-900">{task.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Status</dt>
              <dd className="text-sm font-medium text-gray-900">{task.status}</dd>
            </div>
          </dl>
        </div>

        {timesheet && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Timesheet</h2>
            <dl className="space-y-2">
              {[
                { label: 'Employee', value: timesheet.employee.user.email },
                { label: 'Week Start', value: timesheet.weekStart.toISOString().split('T')[0] },
                { label: 'Total Hours', value: `${timesheet.totalHours}h` },
                { label: 'Notes', value: timesheet.notes ?? '-' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-sm text-gray-500">{label}</dt>
                  <dd className="text-sm font-medium text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {task.status === 'open' || task.status === 'claimed' ? (
          <TaskDecisionForm taskId={id} managerId={session!.user.id} />
        ) : (
          <p className="text-sm text-gray-500">This task has already been completed.</p>
        )}
      </div>
    </div>
  )
}
