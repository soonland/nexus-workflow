import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/db/client'
import OrganizationForm from '@/components/OrganizationForm'

const NewOrganizationPage = async () => {
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
export default NewOrganizationPage
