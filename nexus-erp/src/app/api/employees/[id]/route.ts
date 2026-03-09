import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'

const patchSchema = z.object({
  fullName: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  managerId: z.string().nullable().optional(),
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
  const emp = await db.employee.findUnique({
    where: { id },
    include: { user: { select: { email: true, role: true } }, manager: true },
  })
  if (!emp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(emp)
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

  const emp = await db.employee.update({
    where: { id },
    data: parsed.data,
  })
  return NextResponse.json(emp)
}
