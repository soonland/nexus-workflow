import { redirect, notFound } from 'next/navigation'
import Box from '@mui/material/Box'
import { auth } from '@/auth'
import { db } from '@/db/client'
import AuditLogPanel from '@/components/AuditLogPanel'
import GroupForm from '@/components/GroupForm'

const GroupDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const { id } = await params

  const [group, allPermissions, allUsers] = await Promise.all([
    db.group.findUnique({
      where: { id },
      include: {
        permissions: { select: { permissionKey: true } },
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                employee: { select: { fullName: true } },
              },
            },
          },
        },
      },
    }),
    db.permission.findMany({ orderBy: { key: 'asc' } }),
    db.user.findMany({
      include: { employee: { select: { fullName: true } } },
      orderBy: { email: 'asc' },
    }),
  ])

  if (!group) notFound()

  const users = allUsers.map((u) => ({
    userId: u.id,
    fullName: u.employee?.fullName ?? u.email,
    email: u.email,
  }))

  const defaultMembers = group.members.map((m) => ({
    userId: m.user.id,
    fullName: m.user.employee?.fullName ?? m.user.email,
    email: m.user.email,
  }))

  return (
    <Box>
      <GroupForm
        mode="edit"
        groupId={id}
        defaultName={group.name}
        defaultDescription={group.description ?? ''}
        defaultType={group.type}
        defaultPermissions={group.permissions.map((p) => p.permissionKey)}
        defaultMembers={defaultMembers}
        allPermissions={allPermissions}
        allUsers={users}
      />
      <AuditLogPanel entityType="Group" entityId={id} />
    </Box>
  )
}
export default GroupDetailPage
