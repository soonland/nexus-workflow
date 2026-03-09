import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'

interface Task {
  id: string
  name: string
  assignee?: string
  status: string
  createdAt: string
}

export default async function TasksPage() {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const BASE = process.env.WORKFLOW_API_URL ?? 'http://localhost:3000'
  const res = await fetch(
    `${BASE}/tasks?assignee=${session.user.id}&status=open&pageSize=50`,
    { cache: 'no-store' },
  )
  const data = res.ok ? await res.json() : { items: [], total: 0 }
  const tasks: Task[] = data.items ?? []

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Task Inbox</h1>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {tasks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No pending tasks.</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Task', 'Status', 'Created', ''].map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{task.name}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
                      {task.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(task.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <Link href={`/tasks/${task.id}`} className="text-indigo-600 hover:underline">
                      Review
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
