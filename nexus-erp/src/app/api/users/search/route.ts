import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'

// GET /api/users/search?q=alice — search ERP users by name or email
export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''

  if (q.length < 1) return NextResponse.json([])

  const users = await db.user.findMany({
    where: {
      id: { not: userId },
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { employee: { fullName: { contains: q, mode: 'insensitive' } } },
      ],
    },
    select: {
      id: true,
      email: true,
      employee: { select: { fullName: true } },
    },
    take: 10,
    orderBy: { employee: { fullName: 'asc' } },
  })

  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      name: u.employee?.fullName ?? u.email,
      email: u.email,
    })),
  )
}
