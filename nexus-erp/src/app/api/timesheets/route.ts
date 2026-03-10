import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'

const createSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const timesheets = await db.timesheet.findMany({
    where: {
      employeeId: session.user.employeeId,
      ...(from && to
        ? { weekStart: { gte: new Date(from), lte: new Date(to) } }
        : {}),
    },
    include: { entries: { select: { hours: true } } },
    orderBy: { weekStart: 'desc' },
  })

  const result = timesheets.map(({ entries, ...ts }) => ({
    ...ts,
    totalHours: entries.reduce((sum, e) => sum + Number(e.hours), 0),
  }))

  return NextResponse.json(result)
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

  try {
    const timesheet = await db.timesheet.create({
      data: {
        employeeId: session.user.employeeId,
        weekStart: new Date(parsed.data.weekStart),
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
