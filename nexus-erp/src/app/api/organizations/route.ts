import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().max(200).optional(),
  industry: z.string().max(100).optional(),
  taxId: z.string().max(100).optional(),
  registrationNo: z.string().max(100).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  website: z.string().max(200).optional(),
  street: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  ownerId: z.string().optional().nullable(),
})

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizations = await db.organization.findMany({
    where: { status: { not: 'archived' } },
    include: {
      owner: { select: { id: true, fullName: true } },
    },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(organizations)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { name, legalName, industry, taxId, registrationNo, email, phone, website, street, city, state, postalCode, country, ownerId } = parsed.data

  const org = await db.organization.create({
    data: {
      name,
      legalName: legalName || null,
      industry: industry || null,
      taxId: taxId || null,
      registrationNo: registrationNo || null,
      email: email || null,
      phone: phone || null,
      website: website || null,
      street: street || null,
      city: city || null,
      state: state || null,
      postalCode: postalCode || null,
      country: country || null,
      ownerId: ownerId || null,
    },
    include: {
      owner: { select: { id: true, fullName: true } },
    },
  })
  return NextResponse.json(org, { status: 201 })
}
