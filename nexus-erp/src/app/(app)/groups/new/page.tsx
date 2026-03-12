import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/db/client'
import GroupForm from '@/components/GroupForm'

const NewGroupPage = async () => {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const [allPermissions, allUsers] = await Promise.all([
    db.permission.findMany({ orderBy: { key: 'asc' } }),
    db.user.findMany({
      include: { employee: { select: { fullName: true } } },
      orderBy: { email: 'asc' },
    }),
  ])

  const users = allUsers.map((u) => ({
    userId: u.id,
    fullName: u.employee?.fullName ?? u.email,
    email: u.email,
  }))

  return (
    <GroupForm
      mode="create"
      allPermissions={allPermissions}
      allUsers={users}
    />
  )
}
export default NewGroupPage
