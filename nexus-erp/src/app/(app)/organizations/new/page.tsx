import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import OrganizationForm from '@/components/OrganizationForm'

export default async function NewOrganizationPage() {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const allEmployees = await db.employee.findMany({
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  })

  return (
    <OrganizationForm
      mode="create"
      allEmployees={JSON.parse(JSON.stringify(allEmployees))}
      isManager={true}
      isOwner={false}
    />
  )
}
