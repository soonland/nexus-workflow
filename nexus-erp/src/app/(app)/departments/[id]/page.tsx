import { redirect, notFound } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/db/client'
import DepartmentForm from '@/components/DepartmentForm'

const DepartmentDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const { id } = await params

  const [department, allEmployees, allPermissions] = await Promise.all([
    db.department.findUnique({
      where: { id },
      include: {
        employees: {
          select: { id: true, fullName: true },
          orderBy: { fullName: 'asc' },
        },
        permissions: { select: { permissionKey: true } },
      },
    }),
    db.employee.findMany({
      select: {
        id: true,
        fullName: true,
        departmentId: true,
        department: { select: { name: true } },
      },
      orderBy: { fullName: 'asc' },
    }),
    db.permission.findMany({ orderBy: { key: 'asc' } }),
  ])

  if (!department) notFound()

  const employees = allEmployees.map((e) => ({
    id: e.id,
    fullName: e.fullName,
    departmentId: e.departmentId,
    departmentName: e.department?.name ?? null,
  }))

  return (
    <DepartmentForm
      mode="edit"
      departmentId={id}
      defaultName={department.name}
      defaultMembers={department.employees}
      defaultPermissions={department.permissions.map((p) => p.permissionKey)}
      allEmployees={JSON.parse(JSON.stringify(employees))}
      allPermissions={allPermissions}
    />
  )
}
export default DepartmentDetailPage
