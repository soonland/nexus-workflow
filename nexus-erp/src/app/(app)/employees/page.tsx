import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import Link from 'next/link'

export default async function EmployeesPage() {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const employees = await db.employee.findMany({
    include: { user: { select: { email: true, role: true } } },
    orderBy: { fullName: 'asc' },
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Employees</h1>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {['Name', 'Email', 'Department', 'Hire Date', 'Role', ''].map((h) => (
                <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td className="px-6 py-4 text-sm font-medium text-gray-900">{emp.fullName}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{emp.user.email}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{emp.department}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{emp.hireDate.toISOString().split('T')[0]}</td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  <span className={`px-2 py-1 text-xs rounded ${emp.user.role === 'manager' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
                    {emp.user.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm">
                  <Link href={`/employees/${emp.id}`} className="text-indigo-600 hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
