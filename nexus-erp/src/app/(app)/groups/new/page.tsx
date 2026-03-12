import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import GroupForm from '@/components/GroupForm'

export default async function NewGroupPage() {
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
