import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/db/client'

const putSchema = z.object({
  permissionKeys: z.array(z.string()),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const userPermissions = await db.userPermission.findMany({
    where: { userId: id },
    include: { permission: true },
  })

  return NextResponse.json({ permissions: userPermissions })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const body = await req.json()
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { permissionKeys } = parsed.data

  // Verify the target user exists
  const targetUser = await db.user.findUnique({ where: { id }, select: { id: true } })
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Replace full permission set atomically
  await db.$transaction([
    db.userPermission.deleteMany({ where: { userId: id } }),
    ...(permissionKeys.length > 0
      ? [
          db.userPermission.createMany({
            data: permissionKeys.map((permissionKey) => ({
              userId: id,
              permissionKey,
              grantedById: session.user.id,
            })),
          }),
        ]
      : []),
  ])

  return NextResponse.json({ permissionKeys })
}
