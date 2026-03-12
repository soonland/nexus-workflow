import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { permissionKeys = [] } = body as { permissionKeys: string[] }

  await db.$transaction(async (tx) => {
    await tx.departmentPermission.deleteMany({ where: { departmentId: id } })
    if (permissionKeys.length > 0) {
      await tx.departmentPermission.createMany({
        data: permissionKeys.map((key) => ({ departmentId: id, permissionKey: key })),
      })
    }
  })

  return NextResponse.json({ ok: true })
}
