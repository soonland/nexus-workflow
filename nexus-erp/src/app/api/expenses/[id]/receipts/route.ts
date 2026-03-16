import { fileTypeFromBuffer } from 'file-type'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { createAuditLog } from '@/lib/audit'
import { cloudinary } from '@/lib/cloudinary'
import { canViewAllExpenses, canViewTeamExpenses } from '@/lib/expenseAccess'

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

  const buffer = Buffer.from(await file.arrayBuffer())

  // Verify the actual file content matches the declared MIME type.
  // file.type is client-supplied and can be spoofed — magic byte detection
  // confirms the real format before the file is uploaded.
  const detected = await fileTypeFromBuffer(buffer)
  if (!detected || detected.mime !== file.type) {
    return NextResponse.json({ error: 'File content does not match declared type' }, { status: 415 })
  }

  // Upload to Cloudinary. Use the expense ID as public_id so each report has
  // exactly one receipt slot — re-uploading overwrites the previous file
  // atomically without any separate delete step.
  const publicId = `receipts/${id}`
  const uploadResult = await new Promise<{ public_id: string }>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          public_id: publicId,
          overwrite: true,
          resource_type: 'auto',
          folder: undefined, // public_id already includes the folder prefix
          use_filename: false,
          unique_filename: false,
        },
        (error, result) => {
          if (error || !result) return reject(error ?? new Error('Upload failed'))
          resolve(result)
        },
      )
      .end(buffer)
  })

  const receiptPath = uploadResult.public_id

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
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const report = await db.expenseReport.findUnique({ where: { id } })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Same access-control as GET /api/expenses/[id]
  const viewAll = await canViewAllExpenses(session, db)
  if (!viewAll) {
    const viewTeam = canViewTeamExpenses(session)
    if (viewTeam) {
      const reports = await db.employee.findMany({
        where: { managerId: session.user.employeeId },
        select: { id: true },
      })
      const ids = new Set([session.user.employeeId, ...reports.map((r) => r.id)])
      if (!ids.has(report.employeeId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (report.employeeId !== session.user.employeeId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (!report.receiptPath) {
    return NextResponse.json({ error: 'No receipt attached' }, { status: 404 })
  }

  // Generate a signed URL that expires in 5 minutes.
  const url = cloudinary.url(report.receiptPath, {
    type: 'upload',
    sign_url: true,
    expires_at: Math.floor(Date.now() / 1000) + 300,
    resource_type: 'auto',
  })

  return NextResponse.json({ url })
}
