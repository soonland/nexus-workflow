import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'

const createSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalHours: z.number().min(0).max(168),
  notes: z.string().optional(),
})

export async function GET() {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const timesheets = await db.timesheet.findMany({
    where: { employeeId: session.user.employeeId },
    orderBy: { weekStart: 'desc' },
  })
  return NextResponse.json(timesheets)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { weekStart, totalHours, notes } = parsed.data

  try {
    const timesheet = await db.timesheet.create({
      data: {
        employeeId: session.user.employeeId,
        weekStart: new Date(weekStart),
        totalHours,
        notes,
      },
    })
    return NextResponse.json({ timesheet }, { status: 201 })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      return NextResponse.json({ error: 'A timesheet for this week already exists' }, { status: 409 })
    }
    throw err
  }
}
