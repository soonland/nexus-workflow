import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { listTasks, getTask, completeTask, getInstance } from '@/lib/workflow'

const bodySchema = z.object({
  decision: z.enum(['approved', 'denied']),
  rejectionReason: z.string().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const org = await db.organization.findUnique({
    where: { id },
    select: { id: true, workflowInstanceId: true },
  })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!org.workflowInstanceId) {
    return NextResponse.json({ error: 'No pending status change request' }, { status: 409 })
  }

  // Find the open user task for this workflow instance
  const taskResult = await listTasks({ status: 'open', pageSize: 50 })
  const task = taskResult.items.find(
    (t) => t.instanceId === org.workflowInstanceId && t.elementId === 'await-manager-decision',
  )

  if (!task) {
    // No open task — check if the instance expired (timeout) and clean up lazily
    const instance = await getInstance(org.workflowInstanceId)
    if (!instance || instance.instance.status !== 'active') {
      await db.organization.update({
        where: { id },
        data: { workflowInstanceId: null, statusChangeReason: null },
      })
      return NextResponse.json({ error: 'Status change request has expired' }, { status: 410 })
    }
    return NextResponse.json({ error: 'No open decision task found for this request' }, { status: 409 })
  }

  const body = await req.json()
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { decision, rejectionReason } = parsed.data

  // Fetch task variables to get requestedStatus before completing
  const { variables } = await getTask(task.id)
  const requestedStatus = variables['requestedStatus'] as 'active' | 'inactive' | undefined

  // Apply business logic in nexus-erp before signalling the workflow
  if (decision === 'approved' && requestedStatus) {
    await db.organization.update({
      where: { id },
      data: {
        status: requestedStatus,
        workflowInstanceId: null,
        // statusChangeReason kept as audit trail
      },
    })
  } else {
    await db.organization.update({
      where: { id },
      data: { workflowInstanceId: null, statusChangeReason: null },
    })
  }

  // Signal the workflow engine to advance the state machine
  const outputVariables: Record<string, unknown> = { decision }
  if (rejectionReason) outputVariables.rejectionReason = rejectionReason
  await completeTask(task.id, session.user.id, outputVariables)

  return NextResponse.json({ success: true, decision })
}
