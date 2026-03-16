import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockCanViewAllExpenses,
  mockCanViewTeamExpenses,
  mockExpenseReportFindUnique,
  mockExpenseReportUpdate,
  mockEmployeeFindMany,
  mockAuditLogFindMany,
  mockAuditLogCreate,
  mockLineItemDeleteMany,
  mockLineItemCreateMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCanViewAllExpenses: vi.fn(),
  mockCanViewTeamExpenses: vi.fn(),
  mockExpenseReportFindUnique: vi.fn(),
  mockExpenseReportUpdate: vi.fn(),
  mockEmployeeFindMany: vi.fn(),
  mockAuditLogFindMany: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockLineItemDeleteMany: vi.fn(),
  mockLineItemCreateMany: vi.fn(),
  mockTransaction: vi.fn(),
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
      findUnique: mockExpenseReportFindUnique,
      update: mockExpenseReportUpdate,
    },
    employee: { findMany: mockEmployeeFindMany },
    expenseLineItem: {
      deleteMany: mockLineItemDeleteMany,
      createMany: mockLineItemCreateMany,
    },
    $transaction: mockTransaction,
    auditLog: {
      findMany: mockAuditLogFindMany,
      create: mockAuditLogCreate,
    },
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
import { GET, PATCH } from './route'

const SESSION = { user: { id: 'user-1', email: 'user@example.com', employeeId: 'emp-1', role: 'employee' } }
const PARAMS = { params: Promise.resolve({ id: 'exp-1' }) }

function makeGetRequest() {
  return new NextRequest('http://localhost/api/expenses/exp-1')
}

function makePatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/expenses/exp-1', {
    body: JSON.stringify(body),
  })
}

const BASE_REPORT = {
  id: 'exp-1',
  employeeId: 'emp-1',
  status: 'DRAFT',
  receiptPath: null,
  lineItems: [],
}

describe('GET /api/expenses/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 403 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', employeeId: null } })
    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 403 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 404 when report is not found', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return 200 when user can view all expenses (accounting)', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockCanViewAllExpenses.mockResolvedValue(true)
    mockAuditLogFindMany.mockResolvedValue([])

    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(200)
    expect((res._data as any).id).toBe('exp-1')
  })

  it('should return 200 when user owns the report', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockCanViewAllExpenses.mockResolvedValue(false)
    mockCanViewTeamExpenses.mockReturnValue(false)
    mockAuditLogFindMany.mockResolvedValue([])

    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(200)
  })

  it('should return 403 when employee user does not own the report', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, employeeId: 'emp-other' })
    mockCanViewAllExpenses.mockResolvedValue(false)
    mockCanViewTeamExpenses.mockReturnValue(false)

    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 200 when manager views a direct report expense', async () => {
    const managerSession = { user: { id: 'user-mgr', email: 'mgr@example.com', employeeId: 'emp-mgr', role: 'manager' } }
    mockAuth.mockResolvedValue(managerSession)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, employeeId: 'emp-2' })
    mockCanViewAllExpenses.mockResolvedValue(false)
    mockCanViewTeamExpenses.mockReturnValue(true)
    mockEmployeeFindMany.mockResolvedValue([{ id: 'emp-2' }])
    mockAuditLogFindMany.mockResolvedValue([])

    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(200)
    expect(mockEmployeeFindMany).toHaveBeenCalledWith({
      where: { managerId: 'emp-mgr' },
      select: { id: true },
    })
  })

  it('should return 403 when manager views an expense not from their team', async () => {
    const managerSession = { user: { id: 'user-mgr', email: 'mgr@example.com', employeeId: 'emp-mgr', role: 'manager' } }
    mockAuth.mockResolvedValue(managerSession)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, employeeId: 'emp-other-dept' })
    mockCanViewAllExpenses.mockResolvedValue(false)
    mockCanViewTeamExpenses.mockReturnValue(true)
    mockEmployeeFindMany.mockResolvedValue([{ id: 'emp-2' }])

    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should include auditLogs in the response', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    mockCanViewAllExpenses.mockResolvedValue(true)
    const logs = [{ id: 'log-1', action: 'CREATE', entityId: 'exp-1' }]
    mockAuditLogFindMany.mockResolvedValue(logs)

    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(200)
    expect((res._data as any).auditLogs).toEqual(logs)
  })
})

describe('PATCH /api/expenses/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default $transaction: call the callback with a tx object
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        expenseLineItem: {
          deleteMany: mockLineItemDeleteMany,
          createMany: mockLineItemCreateMany,
        },
        expenseReport: { update: mockExpenseReportUpdate },
      }
      return cb(tx)
    })
  })

  it('should return 403 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', employeeId: null } })
    const res = await PATCH(makePatchRequest({}), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 403 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatchRequest({}), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 404 when report is not found', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(null)
    const res = await PATCH(makePatchRequest({}), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return 403 when user does not own the report', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, employeeId: 'emp-other' })
    const res = await PATCH(makePatchRequest({}), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 400 when lineItems array is empty', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    const res = await PATCH(makePatchRequest({ lineItems: [] }), PARAMS)
    expect(res._status).toBe(400)
  })

  it('should return 400 when a line item has an invalid date format', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    const res = await PATCH(makePatchRequest({
      lineItems: [{ date: '15-01-2025', category: 'MEALS', amount: 50 }],
    }), PARAMS)
    expect(res._status).toBe(400)
  })

  it('should return 400 when status value is not SUBMITTED', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    const res = await PATCH(makePatchRequest({ status: 'APPROVED' }), PARAMS)
    expect(res._status).toBe(400)
  })

  it('should return 422 when trying to resubmit a non-rejected report', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'DRAFT' })
    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)
    expect(res._status).toBe(422)
  })

  it('should return 422 when trying to resubmit an already-submitted report', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'SUBMITTED' })
    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)
    expect(res._status).toBe(422)
  })

  it('should update line items and return 200 on valid lineItems patch', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    const updatedReport = {
      ...BASE_REPORT,
      lineItems: [{ id: 'li-2', date: new Date('2025-02-01'), category: 'MEALS', amount: 75 }],
    }
    mockExpenseReportUpdate.mockResolvedValue(updatedReport)

    const res = await PATCH(makePatchRequest({
      lineItems: [{ date: '2025-02-01', category: 'MEALS', amount: 75 }],
    }), PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).report).toEqual(updatedReport)
    expect(mockLineItemDeleteMany).toHaveBeenCalledWith({ where: { reportId: 'exp-1' } })
    expect(mockLineItemCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ reportId: 'exp-1', category: 'MEALS', amount: 75 }),
        ]),
      }),
    )
  })

  it('should allow resubmitting a REJECTED report', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'REJECTED' })
    const updatedReport = { ...BASE_REPORT, status: 'SUBMITTED', lineItems: [] }
    mockExpenseReportUpdate.mockResolvedValue(updatedReport)

    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).report.status).toBe('SUBMITTED')
    expect(mockExpenseReportUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'SUBMITTED' },
      }),
    )
  })

  it('should not delete/recreate line items when only status is patched', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'REJECTED' })
    mockExpenseReportUpdate.mockResolvedValue({ ...BASE_REPORT, status: 'SUBMITTED', lineItems: [] })

    await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)

    expect(mockLineItemDeleteMany).not.toHaveBeenCalled()
    expect(mockLineItemCreateMany).not.toHaveBeenCalled()
  })
})
