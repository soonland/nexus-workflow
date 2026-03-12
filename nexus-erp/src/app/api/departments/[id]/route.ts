import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'

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
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
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

  await db.department.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
