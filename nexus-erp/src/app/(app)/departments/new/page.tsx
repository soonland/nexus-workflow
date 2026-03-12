import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import DepartmentForm from '@/components/DepartmentForm'

export default async function NewDepartmentPage() {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const allEmployees = await db.employee.findMany({
    select: {
      id: true,
      fullName: true,
      departmentId: true,
      department: { select: { name: true } },
    },
    orderBy: { fullName: 'asc' },
  })

  const employees = allEmployees.map((e) => ({
    id: e.id,
    fullName: e.fullName,
    departmentId: e.departmentId,
    departmentName: e.department?.name ?? null,
  }))

  return <DepartmentForm mode="create" allEmployees={JSON.parse(JSON.stringify(employees))} />
}
