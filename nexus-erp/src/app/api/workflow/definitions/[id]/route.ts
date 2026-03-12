import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { deleteDefinition } from '@/lib/workflow'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  try {
    const result = await deleteDefinition(id)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('404')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (msg.includes('409')) return NextResponse.json({ error: 'HAS_ACTIVE_INSTANCES' }, { status: 409 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
