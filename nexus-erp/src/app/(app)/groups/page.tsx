import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/db/client'
import GroupsTable from '@/components/GroupsTable'

const GroupsPage = async () => {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const groups = await db.group.findMany({
    include: { _count: { select: { permissions: true, members: true } } },
    orderBy: { name: 'asc' },
  })

  return <GroupsTable groups={JSON.parse(JSON.stringify(groups))} />
}
export default GroupsPage
