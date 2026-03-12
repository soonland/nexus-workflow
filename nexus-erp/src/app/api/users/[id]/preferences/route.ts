import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/db/client'

const VALID_THEMES = ['light', 'dark', 'system', 'nexus-light-pro', 'nexus-dark-pro'] as const
const VALID_LOCALES = ['fr', 'en', 'es'] as const

const patchSchema = z.object({
  theme: z.enum(VALID_THEMES).optional(),
  locale: z.enum(VALID_LOCALES).optional(),
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

  if (!parsed.data.theme && !parsed.data.locale) {
    return NextResponse.json({ error: 'At least one preference field required' }, { status: 400 })
  }

  const updated = await db.user.update({
    where: { id },
    data: {
      ...(parsed.data.theme !== undefined && { theme: parsed.data.theme }),
      ...(parsed.data.locale !== undefined && { locale: parsed.data.locale }),
    },
    select: { theme: true, locale: true },
  })

  return NextResponse.json(updated)
}
