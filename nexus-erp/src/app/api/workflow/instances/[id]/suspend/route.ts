import { auth } from '@/auth'
import { suspendInstance } from '@/lib/workflow'
import { NextResponse } from 'next/server'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const result = await suspendInstance(id)
  return NextResponse.json(result)
}
