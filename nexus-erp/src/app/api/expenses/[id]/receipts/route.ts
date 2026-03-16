import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { createAuditLog } from '@/lib/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const report = await db.expenseReport.findUnique({ where: { id } })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (report.employeeId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const EDITABLE = new Set(['DRAFT', 'REJECTED'])
  if (!EDITABLE.has(report.status)) {
    return NextResponse.json({ error: 'Cannot modify a report in this status' }, { status: 422 })
  }

  const formData = await req.formData()
  const file = formData.get('file')
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }

  const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
  }

  const MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  }
  const ext = MIME_TO_EXT[file.type] ?? 'bin'
  const filename = `${id}-${Date.now()}.${ext}`
  const uploadsDir = join(process.cwd(), 'public', 'uploads', 'receipts')
  const filePath = join(uploadsDir, filename)

  await mkdir(uploadsDir, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  const receiptPath = `/uploads/receipts/${filename}`

  await writeFile(filePath, buffer)

  try {
    const updated = await db.$transaction(async (tx) => {
      const result = await tx.expenseReport.update({
        where: { id },
        data: { receiptPath },
      })

      await createAuditLog({
        db: tx,
        entityType: 'ExpenseReport',
        entityId: id,
        action: 'UPDATE',
        actorId: session.user.id,
        actorName: session.user.email ?? session.user.id,
        before: { receiptPath: report.receiptPath },
        after: { receiptPath: result.receiptPath },
      })

      return result
    })

    return NextResponse.json({ receiptPath: updated.receiptPath }, { status: 201 })
  } catch (err) {
    await unlink(filePath).catch(() => {})
    throw err
  }
}
