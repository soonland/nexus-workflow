import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import DepartmentsTable from '@/components/DepartmentsTable'

export default async function DepartmentsPage() {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const departments = await db.department.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { employees: true } } },
  })

  return <DepartmentsTable departments={JSON.parse(JSON.stringify(departments))} />
}
