import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'

const patchSchema = z.object({
  fullName: z.string().min(1).optional(),
  departmentId: z.string().nullable().optional(),
  hireDate: z.string().optional(),
  managerId: z.string().nullable().optional(),
  role: z.enum(['employee', 'manager']).optional(),
  phone: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
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

const contactOnlyFields = ['phone', 'street', 'city', 'state', 'postalCode', 'country'] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const isManager = session.user.role === 'manager'
  const isOwnProfile = session.user.employeeId === id

  if (!isManager && !isOwnProfile) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  // Employees may only update their own contact fields
  if (!isManager) {
    const forbidden = Object.keys(parsed.data).filter(
      (k) => !contactOnlyFields.includes(k as typeof contactOnlyFields[number])
    )
    if (forbidden.length > 0) {
      return NextResponse.json({ error: 'Employees may only update contact information' }, { status: 403 })
    }
  }

  const { role, hireDate, managerId, departmentId, ...empData } = parsed.data

  const emp = await db.employee.update({
    where: { id },
    data: {
      ...empData,
      ...(hireDate !== undefined ? { hireDate: new Date(hireDate) } : {}),
      ...(managerId !== undefined ? { manager: managerId ? { connect: { id: managerId } } : { disconnect: true } } : {}),
      ...(departmentId !== undefined ? { department: departmentId ? { connect: { id: departmentId } } : { disconnect: true } } : {}),
      ...(role ? { user: { update: { role } } } : {}),
    },
  })
  return NextResponse.json(emp)
}
