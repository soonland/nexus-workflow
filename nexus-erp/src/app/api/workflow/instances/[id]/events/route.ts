import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getInstanceEvents } from '@/lib/workflow'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  try {
    const events = await getInstanceEvents(id)
    return NextResponse.json({ events })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('404')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
