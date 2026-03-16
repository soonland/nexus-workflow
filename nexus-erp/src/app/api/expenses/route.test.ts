import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockCanViewAllExpenses,
  mockCanViewTeamExpenses,
  mockExpenseReportFindMany,
  mockExpenseReportCreate,
  mockEmployeeFindMany,
  mockAuditLogCreate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCanViewAllExpenses: vi.fn(),
  mockCanViewTeamExpenses: vi.fn(),
  mockExpenseReportFindMany: vi.fn(),
  mockExpenseReportCreate: vi.fn(),
  mockEmployeeFindMany: vi.fn(),
  mockAuditLogCreate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/expenseAccess', () => ({
  canViewAllExpenses: mockCanViewAllExpenses,
  canViewTeamExpenses: mockCanViewTeamExpenses,
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/db/client', () => ({
  db: {
    expenseReport: {
      findMany: mockExpenseReportFindMany,
      create: mockExpenseReportCreate,
    },
    employee: { findMany: mockEmployeeFindMany },
    auditLog: { create: mockAuditLogCreate },
  },
}))
vi.mock('next/server', () => {
  class MockNextRequest {
    private _body: unknown
    url: string
    nextUrl: URL
    constructor(url: string, init?: { body?: string }) {
      this._body = init?.body ? JSON.parse(init.body) : {}
      this.url = url
      this.nextUrl = new URL(url)
    }
    async json() { return this._body }
  }
  class MockNextResponse {
    _data: unknown; _status: number
    constructor(data: unknown, init?: { status?: number }) { this._data = data; this._status = init?.status ?? 200 }
    static json(data: unknown, init?: { status?: number }) { return new MockNextResponse(data, init) }
  }
  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse }
})

import { NextRequest } from 'next/server'
import { GET, POST } from './route'

const SESSION = { user: { id: 'user-1', email: 'user@example.com', employeeId: 'emp-1', role: 'employee' } }

function makeGetRequest(url = 'http://localhost/api/expenses') {
  return new NextRequest(url)
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/expenses', {
    body: JSON.stringify(body),
  })
}

const EXPENSE_REPORT = {
  id: 'exp-1',
  employeeId: 'emp-1',
  status: 'DRAFT',
  createdAt: new Date('2025-01-01'),
  lineItems: [],
  employee: { fullName: 'Alice Smith' },
}

describe('GET /api/expenses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 403 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', employeeId: null } })
    const res = await GET(makeGetRequest())
    expect(res._status).toBe(403)
  })

  it('should return 403 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetRequest())
    expect(res._status).toBe(403)
  })

  it('should return all expenses when user can view all (accounting)', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockCanViewAllExpenses.mockResolvedValue(true)
    mockExpenseReportFindMany.mockResolvedValue([EXPENSE_REPORT])

    const res = await GET(makeGetRequest())

    expect(res._status).toBe(200)
    expect(res._data).toEqual([EXPENSE_REPORT])
    expect(mockExpenseReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    )
  })

  it('should filter to own + direct reports when user is a manager', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockCanViewAllExpenses.mockResolvedValue(false)
    mockCanViewTeamExpenses.mockReturnValue(true)
    mockEmployeeFindMany.mockResolvedValue([{ id: 'emp-2' }, { id: 'emp-3' }])
    mockExpenseReportFindMany.mockResolvedValue([EXPENSE_REPORT])

    const res = await GET(makeGetRequest())

    expect(res._status).toBe(200)
    expect(mockEmployeeFindMany).toHaveBeenCalledWith({
      where: { managerId: 'emp-1' },
      select: { id: true },
    })
    expect(mockExpenseReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employeeId: { in: ['emp-1', 'emp-2', 'emp-3'] },
        }),
      }),
    )
  })

  it('should filter to own expenses when user is a regular employee', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockCanViewAllExpenses.mockResolvedValue(false)
    mockCanViewTeamExpenses.mockReturnValue(false)
    mockExpenseReportFindMany.mockResolvedValue([EXPENSE_REPORT])

    const res = await GET(makeGetRequest())

    expect(res._status).toBe(200)
    expect(mockExpenseReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ employeeId: 'emp-1' }),
      }),
    )
  })

  it('should pass status filter when provided as query param', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockCanViewAllExpenses.mockResolvedValue(false)
    mockCanViewTeamExpenses.mockReturnValue(false)
    mockExpenseReportFindMany.mockResolvedValue([])

    await GET(makeGetRequest('http://localhost/api/expenses?status=SUBMITTED'))

    expect(mockExpenseReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'SUBMITTED' }),
      }),
    )
  })

  it('should ignore invalid status query param', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockCanViewAllExpenses.mockResolvedValue(false)
    mockCanViewTeamExpenses.mockReturnValue(false)
    mockExpenseReportFindMany.mockResolvedValue([])

    await GET(makeGetRequest('http://localhost/api/expenses?status=HACKED'))

    const callArg = mockExpenseReportFindMany.mock.calls[0][0]
    expect(callArg.where).not.toHaveProperty('status')
  })

  it('should not include status in where clause when no status param', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockCanViewAllExpenses.mockResolvedValue(false)
    mockCanViewTeamExpenses.mockReturnValue(false)
    mockExpenseReportFindMany.mockResolvedValue([])

    await GET(makeGetRequest())

    const callArg = mockExpenseReportFindMany.mock.calls[0][0]
    expect(callArg.where).not.toHaveProperty('status')
  })
})

describe('POST /api/expenses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 403 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', employeeId: null } })
    const res = await POST(makePostRequest({ lineItems: [] }))
    expect(res._status).toBe(403)
  })

  it('should return 403 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostRequest({}))
    expect(res._status).toBe(403)
  })

  it('should return 400 when lineItems is empty', async () => {
    mockAuth.mockResolvedValue(SESSION)
    const res = await POST(makePostRequest({ lineItems: [] }))
    expect(res._status).toBe(400)
  })

  it('should return 400 when lineItems is missing', async () => {
    mockAuth.mockResolvedValue(SESSION)
    const res = await POST(makePostRequest({}))
    expect(res._status).toBe(400)
  })

  it('should return 400 when a line item has an invalid date format', async () => {
    mockAuth.mockResolvedValue(SESSION)
    const res = await POST(makePostRequest({
      lineItems: [{ date: '01/15/2025', category: 'TRAVEL', amount: 100 }],
    }))
    expect(res._status).toBe(400)
  })

  it('should return 400 when a line item has an invalid category', async () => {
    mockAuth.mockResolvedValue(SESSION)
    const res = await POST(makePostRequest({
      lineItems: [{ date: '2025-01-15', category: 'FOOD', amount: 100 }],
    }))
    expect(res._status).toBe(400)
  })

  it('should return 400 when a line item has a non-positive amount', async () => {
    mockAuth.mockResolvedValue(SESSION)
    const res = await POST(makePostRequest({
      lineItems: [{ date: '2025-01-15', category: 'MEALS', amount: 0 }],
    }))
    expect(res._status).toBe(400)
  })

  it('should return 201 with created report on valid input', async () => {
    mockAuth.mockResolvedValue(SESSION)
    const createdReport = {
      id: 'exp-new',
      employeeId: 'emp-1',
      status: 'DRAFT',
      receiptPath: null,
      lineItems: [{ id: 'li-1', date: new Date('2025-01-15'), category: 'TRAVEL', amount: 150, description: 'Flight' }],
    }
    mockExpenseReportCreate.mockResolvedValue(createdReport)

    const res = await POST(makePostRequest({
      lineItems: [{ date: '2025-01-15', category: 'TRAVEL', amount: 150, description: 'Flight' }],
    }))

    expect(res._status).toBe(201)
    expect((res._data as any).report).toEqual(createdReport)
    expect(mockExpenseReportCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeId: 'emp-1' }),
      }),
    )
  })

  it('should create report for all valid categories', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportCreate.mockResolvedValue({ id: 'exp-2', employeeId: 'emp-1', status: 'DRAFT', lineItems: [] })

    for (const category of ['TRAVEL', 'MEALS', 'EQUIPMENT', 'OTHER']) {
      mockExpenseReportCreate.mockClear()
      const res = await POST(makePostRequest({
        lineItems: [{ date: '2025-01-15', category, amount: 50 }],
      }))
      expect(res._status).toBe(201)
    }
  })
})
