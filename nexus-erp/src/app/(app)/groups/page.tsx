import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import GroupsTable from '@/components/GroupsTable'

export default async function GroupsPage() {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const groups = await db.group.findMany({
    include: { _count: { select: { permissions: true, members: true } } },
    orderBy: { name: 'asc' },
  })

  return <GroupsTable groups={JSON.parse(JSON.stringify(groups))} />
}
