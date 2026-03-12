import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { canAccess } from '@/lib/access'

const patchSchema = z.object({
  fullName: z.string().min(1).optional(),
  departmentId: z.string().nullable().optional(),
  hireDate: z.string().optional(),
  managerId: z.string().nullable().optional(),
  role: z.enum(['employee', 'manager']).optional(),
  phone: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const emp = await db.employee.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          email: true,
          role: true,
          permissions: { include: { permission: true } },
          groups: {
            include: {
              group: {
                select: {
                  id: true,
                  name: true,
                  permissions: { select: { permissionKey: true } },
                },
              },
            },
          },
        },
      },
      manager: { select: { id: true, fullName: true } },
      department: { select: { id: true, name: true } },
    },
  })
  if (!emp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const allowed = await canAccess(session, 'employees', 'read', emp.userId, db)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Compute effective permissions (direct + inherited via groups)
  const directPerms = emp.user.permissions.map((up) => ({
    key: up.permission.key,
    label: up.permission.label,
    source: 'direct' as const,
  }))
  const groupPerms = emp.user.groups.flatMap((gm) =>
    gm.group.permissions.map((gp) => ({
      key: gp.permissionKey,
      label: '',
      source: 'group' as const,
      groupId: gm.group.id,
      groupName: gm.group.name,
    }))
  )
  // Merge: for each unique key collect all sources
  const permMap = new Map<string, { key: string; label: string; direct: boolean; groups: { id: string; name: string }[] }>()
  for (const p of directPerms) {
    permMap.set(p.key, { key: p.key, label: p.label, direct: true, groups: [] })
  }
  for (const p of groupPerms) {
    const existing = permMap.get(p.key)
    if (existing) {
      existing.groups.push({ id: p.groupId, name: p.groupName })
    } else {
      permMap.set(p.key, { key: p.key, label: p.key, direct: false, groups: [{ id: p.groupId, name: p.groupName }] })
    }
  }

  return NextResponse.json({
    id: emp.id,
    fullName: emp.fullName,
    hireDate: emp.hireDate,
    phone: emp.phone,
    street: emp.street,
    city: emp.city,
    state: emp.state,
    postalCode: emp.postalCode,
    country: emp.country,
    department: emp.department,
    manager: emp.manager,
    user: { email: emp.user.email, role: emp.user.role },
    groups: emp.user.groups.map((gm) => ({ id: gm.group.id, name: gm.group.name })),
    effectivePermissions: Array.from(permMap.values()),
  })
}

const contactOnlyFields = ['phone', 'street', 'city', 'state', 'postalCode', 'country'] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const isManager = session.user.role === 'manager'
  const isOwnProfile = session.user.employeeId === id

  if (!isManager && !isOwnProfile) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  // Employees may only update their own contact fields
  if (!isManager) {
    const forbidden = Object.keys(parsed.data).filter(
      (k) => !contactOnlyFields.includes(k as typeof contactOnlyFields[number])
    )
    if (forbidden.length > 0) {
      return NextResponse.json({ error: 'Employees may only update contact information' }, { status: 403 })
    }
  }

  const { role, hireDate, managerId, departmentId, ...empData } = parsed.data

  const emp = await db.employee.update({
    where: { id },
    data: {
      ...empData,
      ...(hireDate !== undefined ? { hireDate: new Date(hireDate) } : {}),
      ...(managerId !== undefined ? { manager: managerId ? { connect: { id: managerId } } : { disconnect: true } } : {}),
      ...(departmentId !== undefined ? { department: departmentId ? { connect: { id: departmentId } } : { disconnect: true } } : {}),
      ...(role ? { user: { update: { role } } } : {}),
    },
  })
  return NextResponse.json(emp)
}
