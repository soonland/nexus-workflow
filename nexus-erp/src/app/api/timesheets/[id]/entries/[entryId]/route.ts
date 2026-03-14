import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'

const updateSchema = z.object({
  hours: z.number().positive().max(24),
  projectCode: z.string().max(50).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
})

async function resolveEntry(timesheetId: string, entryId: string, employeeId: string) {
  const ts = await db.timesheet.findUnique({ where: { id: timesheetId } })
  if (!ts) return { error: 'Not found', status: 404 } as const
  if (ts.employeeId !== employeeId) return { error: 'Forbidden', status: 403 } as const
  if (ts.status !== 'draft' && ts.status !== 'revision_requested') {
    return { error: 'Timesheet is not editable', status: 422 } as const
  }
  const entry = await db.timesheetEntry.findUnique({ where: { id: entryId, timesheetId } })
  if (!entry) return { error: 'Not found', status: 404 } as const
  return { ts, entry }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, entryId } = await params
  const result = await resolveEntry(id, entryId, session.user.employeeId)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const entry = await db.timesheetEntry.update({
    where: { id: entryId },
    data: {
      hours: parsed.data.hours,
      projectCode: parsed.data.projectCode ?? null,
      description: parsed.data.description ?? null,
    },
  })

  return NextResponse.json({ entry })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, entryId } = await params
  const result = await resolveEntry(id, entryId, session.user.employeeId)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })

  await db.timesheetEntry.delete({ where: { id: entryId } })
  return new NextResponse(null, { status: 204 })
}
