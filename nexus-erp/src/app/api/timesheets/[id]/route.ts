import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { auth } from '@/auth'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const ts = await db.timesheet.findUnique({ where: { id } })
  if (!ts) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only owner or manager can view
  if (session.user.role !== 'manager' && ts.employeeId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(ts)
}
