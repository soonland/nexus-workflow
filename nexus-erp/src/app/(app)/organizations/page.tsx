import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import OrganizationsTable from '@/components/OrganizationsTable'

export default async function OrganizationsPage() {
  const session = await auth()
  if (!session) redirect('/dashboard')

  const organizations = await db.organization.findMany({
    where: { status: { not: 'archived' } },
    include: {
      owner: { select: { id: true, fullName: true } },
    },
    orderBy: { name: 'asc' },
  })

  const isManager = session.user.role === 'manager'

  return (
    <OrganizationsTable
      organizations={JSON.parse(JSON.stringify(organizations))}
      isManager={isManager}
    />
  )
}
