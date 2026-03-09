import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getTask } from '@/lib/workflow'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  try {
    const result = await getTask(id)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
}
