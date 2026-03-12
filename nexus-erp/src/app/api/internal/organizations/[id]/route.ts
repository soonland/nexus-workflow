import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? ''

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token || token !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const org = await db.organization.findUnique({
    where: { id },
    include: { owner: { select: { id: true, userId: true, fullName: true } } },
  })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(org)
}
