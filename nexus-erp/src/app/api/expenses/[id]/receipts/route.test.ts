import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockExpenseReportFindUnique,
  mockExpenseReportUpdate,
  mockAuditLogCreate,
  mockWriteFile,
  mockMkdir,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockExpenseReportFindUnique: vi.fn(),
  mockExpenseReportUpdate: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/db/client', () => ({
  db: {
    expenseReport: {
      findUnique: mockExpenseReportFindUnique,
      update: mockExpenseReportUpdate,
    },
    auditLog: { create: mockAuditLogCreate },
  },
}))
vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}))
// path.join is used to build the upload directory — keep real join logic
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
import { POST } from './route'

const SESSION = { user: { id: 'user-1', email: 'user@example.com', employeeId: 'emp-1' } }
const PARAMS = { params: Promise.resolve({ id: 'exp-1' }) }

const BASE_REPORT = {
  id: 'exp-1',
  employeeId: 'emp-1',
  status: 'DRAFT',
  receiptPath: null,
}

function makeMockFile(name = 'receipt.pdf', content = 'pdf-content'): File {
  return new File([content], name, { type: 'application/pdf' })
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

describe('POST /api/expenses/[id]/receipts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
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

    // FormData with no file appended
    const fd = new FormData()
    const req = new (NextRequest as any)('http://localhost/api/expenses/exp-1/receipts', {
      formData: fd,
    })
    const res = await POST(req, PARAMS)
    expect(res._status).toBe(400)
  })

  it('should return 201 with receiptPath on successful upload', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    const updatedReport = { ...BASE_REPORT, receiptPath: '/uploads/receipts/exp-1-123456789.pdf' }
    mockExpenseReportUpdate.mockResolvedValue(updatedReport)

    const res = await POST(makeRequest(makeMockFile('receipt.pdf')), PARAMS)

    expect(res._status).toBe(201)
    expect((res._data as any).receiptPath).toMatch(/^\/uploads\/receipts\/exp-1-\d+\.pdf$/)
  })

  it('should call mkdir with recursive: true before writing the file', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockExpenseReportUpdate.mockResolvedValue({ ...BASE_REPORT, receiptPath: '/uploads/receipts/exp-1-123.pdf' })

    await POST(makeRequest(makeMockFile()), PARAMS)

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('receipts'),
      { recursive: true },
    )
  })

  it('should call writeFile with a buffer of the uploaded file content', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockExpenseReportUpdate.mockResolvedValue({ ...BASE_REPORT, receiptPath: '/uploads/receipts/exp-1-123.pdf' })

    await POST(makeRequest(makeMockFile('receipt.pdf', 'binary-content')), PARAMS)

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const [filePath, buffer] = mockWriteFile.mock.calls[0]
    expect(filePath).toMatch(/exp-1-\d+\.pdf$/)
    expect(Buffer.isBuffer(buffer)).toBe(true)
  })

  it('should preserve the file extension in the stored filename', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockExpenseReportUpdate.mockResolvedValue({ ...BASE_REPORT, receiptPath: '/uploads/receipts/exp-1-123.png' })

    await POST(makeRequest(makeMockFile('photo.png', 'img')), PARAMS)

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.png$/),
      expect.any(Buffer),
    )
  })

  it('should update the expenseReport with the new receiptPath', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockExpenseReportUpdate.mockResolvedValue({ ...BASE_REPORT, receiptPath: '/uploads/receipts/exp-1-123.pdf' })

    await POST(makeRequest(makeMockFile('receipt.pdf')), PARAMS)

    expect(mockExpenseReportUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exp-1' },
        data: expect.objectContaining({ receiptPath: expect.stringMatching(/^\/uploads\/receipts\/exp-1-\d+\.pdf$/) }),
      }),
    )
  })
})
