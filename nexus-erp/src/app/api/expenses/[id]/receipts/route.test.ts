import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockExpenseReportFindUnique,
  mockExpenseReportUpdate,
  mockEmployeeFindMany,
  mockCreateAuditLog,
  mockTransaction,
  mockFileTypeFromBuffer,
  mockCanViewAllExpenses,
  mockUploadStream,
  mockCloudinaryUrl,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockExpenseReportFindUnique: vi.fn(),
  mockExpenseReportUpdate: vi.fn(),
  mockEmployeeFindMany: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue(undefined),
  mockTransaction: vi.fn(),
  mockFileTypeFromBuffer: vi.fn(),
  mockCanViewAllExpenses: vi.fn(),
  mockUploadStream: vi.fn(),
  mockCloudinaryUrl: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('file-type', () => ({ fileTypeFromBuffer: mockFileTypeFromBuffer }))
vi.mock('@/lib/audit', () => ({ createAuditLog: mockCreateAuditLog }))
vi.mock('@/lib/expenseAccess', () => ({
  canViewAllExpenses: mockCanViewAllExpenses,
  canViewTeamExpenses: () => false,
}))
vi.mock('@/db/client', () => ({
  db: {
    expenseReport: {
      findUnique: mockExpenseReportFindUnique,
      update: mockExpenseReportUpdate,
    },
    employee: { findMany: mockEmployeeFindMany },
    $transaction: mockTransaction,
  },
}))
vi.mock('@/lib/cloudinary', () => ({
  cloudinary: {
    uploader: { upload_stream: mockUploadStream },
    url: mockCloudinaryUrl,
  },
}))
vi.mock('next/server', () => {
  class MockNextRequest {
    private _formData: FormData | null
    url: string
    nextUrl: URL
    constructor(url: string, init?: { formData?: FormData }) {
      this._formData = init?.formData ?? null
      this.url = url
      this.nextUrl = new URL(url)
    }
    async formData() { return this._formData }
    async json() { return {} }
  }
  class MockNextResponse {
    _data: unknown; _status: number
    constructor(data: unknown, init?: { status?: number }) { this._data = data; this._status = init?.status ?? 200 }
    static json(data: unknown, init?: { status?: number }) { return new MockNextResponse(data, init) }
  }
  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse }
})

import { NextRequest } from 'next/server'
import { POST, GET } from './route'

const SESSION = { user: { id: 'user-1', email: 'user@example.com', employeeId: 'emp-1' } }
const PARAMS = { params: Promise.resolve({ id: 'exp-1' }) }

const BASE_REPORT = {
  id: 'exp-1',
  employeeId: 'emp-1',
  status: 'DRAFT',
  receiptPath: null,
}

function makeMockFile(name = 'receipt.pdf', content = 'pdf-content', type = 'application/pdf'): File {
  return new File([content], name, { type })
}

function makeRequest(file?: File | null) {
  const fd = new FormData()
  if (file !== undefined) {
    if (file !== null) fd.append('file', file)
  }
  return new (NextRequest as any)('http://localhost/api/expenses/exp-1/receipts', {
    formData: fd,
  })
}

/** Makes mockUploadStream resolve with a successful Cloudinary result. */
function mockUploadSuccess(publicId = 'receipts/exp-1') {
  mockUploadStream.mockImplementation(
    (_opts: unknown, cb: (err: null, result: { public_id: string }) => void) => {
      const stream = { end: () => cb(null, { public_id: publicId }) }
      return stream
    },
  )
}

/** Makes mockUploadStream reject with an error. */
function mockUploadFailure(message = 'Upload failed') {
  mockUploadStream.mockImplementation(
    (_opts: unknown, cb: (err: Error, result: null) => void) => {
      const stream = { end: () => cb(new Error(message), null) }
      return stream
    },
  )
}

describe('POST /api/expenses/[id]/receipts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateAuditLog.mockResolvedValue(undefined)
    mockFileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' })
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        expenseReport: { update: mockExpenseReportUpdate },
        auditLog: { create: vi.fn() },
      }
      return cb(tx)
    })
    mockUploadSuccess()
  })

  it('should return 403 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', employeeId: null } })
    const res = await POST(makeRequest(makeMockFile()), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 403 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(makeMockFile()), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 404 when report is not found', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(null)
    const res = await POST(makeRequest(makeMockFile()), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return 403 when user does not own the report', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, employeeId: 'emp-other' })
    const res = await POST(makeRequest(makeMockFile()), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 422 when report is in a non-editable status', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'APPROVED_ACCOUNTING' })
    const res = await POST(makeRequest(makeMockFile()), PARAMS)
    expect(res._status).toBe(422)
  })

  it('should return 413 when file exceeds 10MB', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    const largeFile = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(largeFile, 'size', { value: 11 * 1024 * 1024 })
    const res = await POST(makeRequest(largeFile), PARAMS)
    expect(res._status).toBe(413)
  })

  it('should return 415 when file type is not allowed', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    const htmlFile = new File(['<script>alert(1)</script>'], 'evil.html', { type: 'text/html' })
    const res = await POST(makeRequest(htmlFile), PARAMS)
    expect(res._status).toBe(415)
  })

  it('should return 400 when no file is provided in the form data', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    const fd = new FormData()
    const req = new (NextRequest as any)('http://localhost/api/expenses/exp-1/receipts', {
      formData: fd,
    })
    const res = await POST(req, PARAMS)
    expect(res._status).toBe(400)
  })

  it('should return 415 when magic bytes do not match the declared MIME type', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockFileTypeFromBuffer.mockResolvedValue({ mime: 'image/png', ext: 'png' })
    const res = await POST(makeRequest(makeMockFile('evil.pdf', 'content', 'application/pdf')), PARAMS)
    expect(res._status).toBe(415)
    expect(mockUploadStream).not.toHaveBeenCalled()
  })

  it('should return 415 when file-type cannot detect the content type', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockFileTypeFromBuffer.mockResolvedValue(undefined)
    const res = await POST(makeRequest(makeMockFile()), PARAMS)
    expect(res._status).toBe(415)
    expect(mockUploadStream).not.toHaveBeenCalled()
  })

  it('should return 201 with receiptPath on successful upload', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockExpenseReportUpdate.mockResolvedValue({ ...BASE_REPORT, receiptPath: 'receipts/exp-1' })

    const res = await POST(makeRequest(makeMockFile('receipt.pdf')), PARAMS)

    expect(res._status).toBe(201)
    expect((res._data as any).receiptPath).toBe('receipts/exp-1')
  })

  it('should upload to Cloudinary with overwrite:true and the expense-scoped public_id', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockExpenseReportUpdate.mockResolvedValue({ ...BASE_REPORT, receiptPath: 'receipts/exp-1' })

    await POST(makeRequest(makeMockFile()), PARAMS)

    expect(mockUploadStream).toHaveBeenCalledWith(
      expect.objectContaining({ public_id: 'receipts/exp-1', overwrite: true }),
      expect.any(Function),
    )
  })

  it('should propagate Cloudinary upload errors', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockUploadFailure('network error')

    await expect(POST(makeRequest(makeMockFile()), PARAMS)).rejects.toThrow('network error')
  })
})

describe('GET /api/expenses/[id]/receipts', () => {
  const GET_PARAMS = { params: Promise.resolve({ id: 'exp-1' }) }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCanViewAllExpenses.mockResolvedValue(false)
  })

  function makeGetRequest() {
    return new (NextRequest as any)('http://localhost/api/expenses/exp-1/receipts', {})
  }

  it('should return 403 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), GET_PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 403 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', employeeId: null } })
    const res = await GET(makeGetRequest(), GET_PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 404 when report does not exist', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), GET_PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return 403 when user does not own the report and has no elevated access', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, employeeId: 'emp-other' })
    const res = await GET(makeGetRequest(), GET_PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 404 when report has no receipt attached', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT) // receiptPath: null
    const res = await GET(makeGetRequest(), GET_PARAMS)
    expect(res._status).toBe(404)
    expect((res._data as any).error).toBe('No receipt attached')
  })

  it('should return 200 with a signed URL for the report owner', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, receiptPath: 'receipts/exp-1' })
    mockCloudinaryUrl.mockReturnValue('https://res.cloudinary.com/signed-url')

    const res = await GET(makeGetRequest(), GET_PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).url).toBe('https://res.cloudinary.com/signed-url')
    expect(mockCloudinaryUrl).toHaveBeenCalledWith(
      'receipts/exp-1',
      expect.objectContaining({ sign_url: true }),
    )
  })

  it('should return 200 with a signed URL for users with canViewAllExpenses', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com', employeeId: 'emp-admin' } })
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, employeeId: 'emp-other', receiptPath: 'receipts/exp-1' })
    mockCanViewAllExpenses.mockResolvedValue(true)
    mockCloudinaryUrl.mockReturnValue('https://res.cloudinary.com/signed-url')

    const res = await GET(makeGetRequest(), GET_PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).url).toBeDefined()
  })
})
