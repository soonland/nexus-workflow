import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/db/client'
import DepartmentsTable from '@/components/DepartmentsTable'

const DepartmentsPage = async () => {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const departments = await db.department.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { employees: true } } },
  })

  return <DepartmentsTable departments={JSON.parse(JSON.stringify(departments))} />
}
export default DepartmentsPage
