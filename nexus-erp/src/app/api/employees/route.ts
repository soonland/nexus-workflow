import { NextRequest, NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  department: z.string().min(1),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const employees = await db.employee.findMany({
    include: { user: { select: { email: true, role: true } } },
    orderBy: { fullName: 'asc' },
  })
  return NextResponse.json(employees)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { email, password, fullName, department, hireDate } = parsed.data

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
  }

  const passwordHash = await hash(password, 12)
  const result = await db.user.create({
    data: {
      email,
      passwordHash,
      role: 'employee',
      employee: {
        create: {
          fullName,
          department,
          hireDate: new Date(hireDate),
        },
      },
    },
    include: { employee: true },
  })

  return NextResponse.json({ user: { id: result.id, email: result.email, role: result.role }, employee: result.employee }, { status: 201 })
}
