import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().positive().max(24),
  projectCode: z.string().max(50).nullish(),
  description: z.string().max(500).nullish(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const ts = await db.timesheet.findUnique({ where: { id } })
  if (!ts) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ts.employeeId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (ts.status !== 'draft' && ts.status !== 'revision_requested') {
    return NextResponse.json({ error: 'Timesheet is not editable' }, { status: 422 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const entry = await db.timesheetEntry.create({
    data: {
      timesheetId: id,
      date: new Date(parsed.data.date),
      hours: parsed.data.hours,
      projectCode: parsed.data.projectCode ?? null,
      description: parsed.data.description ?? null,
    },
  })

  return NextResponse.json({ entry }, { status: 201 })
}
