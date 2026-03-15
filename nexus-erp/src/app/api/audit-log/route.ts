import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'

const PAGE_SIZE = 25

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = req.nextUrl

  const entityTypes = searchParams.getAll('entityType')
  const actions = searchParams.getAll('action')
  const actorId = searchParams.get('actorId') ?? undefined
  const entityId = searchParams.get('entityId') ?? undefined
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))

  const where: Prisma.AuditLogWhereInput = {}

  if (entityTypes.length > 0) where.entityType = { in: entityTypes }
  if (actions.length > 0) {
    const validActions = actions.filter((a) => ['CREATE', 'UPDATE', 'DELETE'].includes(a)) as ('CREATE' | 'UPDATE' | 'DELETE')[]
    if (validActions.length > 0) where.action = { in: validActions }
  }
  if (actorId) where.actorId = actorId
  if (entityId) where.entityId = entityId
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    }
  }

  const [total, entries] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])

  return NextResponse.json({
    entries,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil(total / PAGE_SIZE),
  })
}
