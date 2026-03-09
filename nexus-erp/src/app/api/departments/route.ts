import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'

const createSchema = z.object({
  name: z.string().min(1).max(100),
})

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const departments = await db.department.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { employees: true } } },
  })
  return NextResponse.json(departments)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  try {
    const department = await db.department.create({
      data: { name: parsed.data.name },
      include: { _count: { select: { employees: true } } },
    })
    return NextResponse.json(department, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'A department with that name already exists' }, { status: 409 })
  }
}
