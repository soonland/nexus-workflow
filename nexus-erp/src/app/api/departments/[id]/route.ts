import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { createAuditLog } from '@/lib/audit'

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  memberIds: z.array(z.string()).optional(),
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
  const department = await db.department.findUnique({
    where: { id },
    include: {
      employees: {
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      },
      _count: { select: { employees: true } },
    },
  })
  if (!department) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(department)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { name, memberIds } = parsed.data

  try {
    await db.$transaction(async (tx) => {
      if (name !== undefined) {
        await tx.department.update({ where: { id }, data: { name } })
      }
      if (memberIds !== undefined) {
        await tx.employee.updateMany({
          where: { departmentId: id, id: { notIn: memberIds } },
          data: { departmentId: null },
        })
        if (memberIds.length > 0) {
          await tx.employee.updateMany({
            where: { id: { in: memberIds } },
            data: { departmentId: id },
          })
        }
      }
    })
    const updated = await db.department.findUnique({
      where: { id },
      include: { _count: { select: { employees: true } } },
    })

    await createAuditLog({
      db,
      entityType: 'Department',
      entityId: id,
      action: 'UPDATE',
      actorId: session.user.id,
      actorName: session.user.email ?? session.user.id,
      after: parsed.data as Record<string, unknown>,
    })

    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Not found or name already exists' }, { status: 409 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const employeeCount = await db.employee.count({ where: { departmentId: id } })
  if (employeeCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${employeeCount} employee(s) are assigned to this department` },
      { status: 409 },
    )
  }

  const dept = await db.department.findUnique({ where: { id }, select: { name: true } })
  await db.department.delete({ where: { id } })

  await createAuditLog({
    db,
    entityType: 'Department',
    entityId: id,
    action: 'DELETE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    before: { id, name: dept?.name } as Record<string, unknown>,
  })

  return new NextResponse(null, { status: 204 })
}
