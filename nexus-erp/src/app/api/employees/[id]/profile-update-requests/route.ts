import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/db/client'
import { startInstance } from '@/lib/workflow'

const requestSchema = z.object({
  phone: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Employees may only submit requests for their own profile
  if (session.user.role !== 'manager' && session.user.employeeId !== id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  // Block if there is already a pending request for this employee
  const existing = await db.employeeProfileUpdateRequest.findFirst({
    where: { employeeId: id, status: 'PENDING' },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'A profile update request is already pending HR review' },
      { status: 409 },
    )
  }

  // Resolve the HR manager to assign the review task to.
  // Prefer a manager in the HR department; fall back to any manager.
  const hrManager = await db.employee.findFirst({
    where: { user: { role: 'manager' }, department: { name: 'HR' } },
    include: { user: { select: { id: true } } },
  })
  const assignee = hrManager ?? await db.employee.findFirst({
    where: { user: { role: 'manager' } },
    include: { user: { select: { id: true } } },
  })

  if (!assignee) {
    return NextResponse.json({ error: 'No manager available to review the request' }, { status: 422 })
  }

  // Create the staging record
  const request = await db.employeeProfileUpdateRequest.create({
    data: {
      employeeId: id,
      phone: parsed.data.phone ?? null,
      street: parsed.data.street ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      postalCode: parsed.data.postalCode ?? null,
      country: parsed.data.country ?? null,
    },
  })

  // Start the workflow instance
  const instance = await startInstance(
    'update-profile-info',
    {
      updateRequestId: request.id,
      employeeId: id,
      hrManagerId: assignee.user.id,
    },
    `profile-update-${request.id}`,
  )

  // Patch the workflow instance ID back onto the staging record
  await db.employeeProfileUpdateRequest.update({
    where: { id: request.id },
    data: { workflowInstanceId: instance.id },
  })

  return NextResponse.json({ request, workflowInstanceId: instance.id }, { status: 201 })
}
