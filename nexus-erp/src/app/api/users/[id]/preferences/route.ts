import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/db/client'

const VALID_THEMES = ['light', 'dark', 'system', 'nexus-light-pro', 'nexus-dark-pro'] as const

const patchSchema = z.object({
  theme: z.enum(VALID_THEMES),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  // Users may only update their own preferences
  if (session.user.id !== id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  await db.user.update({
    where: { id },
    data: { theme: parsed.data.theme },
  })

  return NextResponse.json({ theme: parsed.data.theme })
}
