import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockCanViewAllExpenses,
  mockCanViewTeamExpenses,
  mockExpenseReportFindUnique,
  mockExpenseReportUpdate,
  mockExpenseReportUpdateMany,
  mockExpenseReportFindUniqueInTx,
  mockEmployeeFindUnique,
  mockEmployeeFindMany,
  mockAuditLogFindMany,
  mockAuditLogCreate,
  mockCreateAuditLog,
  mockLineItemDeleteMany,
  mockLineItemCreateMany,
  mockTransaction,
  mockStartInstance,
  mockCancelInstance,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCanViewAllExpenses: vi.fn(),
  mockCanViewTeamExpenses: vi.fn(),
  mockExpenseReportFindUnique: vi.fn(),
  mockExpenseReportUpdate: vi.fn(),
  mockEmployeeFindUnique: vi.fn(),
  mockEmployeeFindMany: vi.fn(),
  mockAuditLogFindMany: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue(undefined),
  mockLineItemDeleteMany: vi.fn(),
  mockLineItemCreateMany: vi.fn(),
  mockTransaction: vi.fn(),
  mockStartInstance: vi.fn(),
  mockCancelInstance: vi.fn(),
  mockExpenseReportUpdateMany: vi.fn(),
  mockExpenseReportFindUniqueInTx: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/expenseAccess', () => ({
  canViewAllExpenses: mockCanViewAllExpenses,
  canViewTeamExpenses: mockCanViewTeamExpenses,
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: mockCreateAuditLog }))
vi.mock('@/lib/workflow', () => ({ startInstance: mockStartInstance, cancelInstance: mockCancelInstance }))
vi.mock('@/db/client', () => ({
  db: {
    expenseReport: {
      findUnique: mockExpenseReportFindUnique,
      update: mockExpenseReportUpdate,
      updateMany: mockExpenseReportUpdateMany,
    },
    employee: { findUnique: mockEmployeeFindUnique, findMany: mockEmployeeFindMany },
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
    mockCreateAuditLog.mockResolvedValue(undefined)
    // Default workflow mock: resolves with a fake instance
    mockStartInstance.mockResolvedValue({ id: 'wf-instance-1' })
    mockCancelInstance.mockResolvedValue({ instance: { id: 'wf-instance-1', status: 'cancelled' } })
    // Default employee with manager for SUBMITTED path
    mockEmployeeFindUnique.mockResolvedValue({
      id: 'emp-1',
      manager: { user: { id: 'user-mgr' } },
    })
    // Default SUBMITTED-path tx mocks
    mockExpenseReportUpdateMany.mockResolvedValue({ count: 1 })
    mockExpenseReportFindUniqueInTx.mockResolvedValue({ ...BASE_REPORT, status: 'SUBMITTED', workflowInstanceId: 'wf-instance-1', lineItems: [] })
    // Default $transaction: call the callback with a tx object
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        expenseLineItem: {
          deleteMany: mockLineItemDeleteMany,
          createMany: mockLineItemCreateMany,
        },
        expenseReport: {
          update: mockExpenseReportUpdate,
          updateMany: mockExpenseReportUpdateMany,
          findUnique: mockExpenseReportFindUniqueInTx,
        },
        auditLog: { create: mockAuditLogCreate },
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

  it('should return 400 when body is empty (no lineItems or status)', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    const res = await PATCH(makePatchRequest({}), PARAMS)
    expect(res._status).toBe(400)
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

  it('should return 422 when editing line items on a SUBMITTED report', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'SUBMITTED' })
    const res = await PATCH(makePatchRequest({
      lineItems: [{ date: '2025-01-15', category: 'MEALS', amount: 50 }],
    }), PARAMS)
    expect(res._status).toBe(422)
  })

  it('should return 422 when editing line items on an APPROVED_MANAGER report', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'APPROVED_MANAGER' })
    const res = await PATCH(makePatchRequest({
      lineItems: [{ date: '2025-01-15', category: 'MEALS', amount: 50 }],
    }), PARAMS)
    expect(res._status).toBe(422)
  })

  it('should return 422 when trying to submit a report in APPROVED_MANAGER status', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'APPROVED_MANAGER' })
    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)
    expect(res._status).toBe(422)
  })

  it('should allow submitting a DRAFT report', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'DRAFT' })
    const updatedReport = { ...BASE_REPORT, status: 'SUBMITTED', lineItems: [] }
    mockExpenseReportUpdate.mockResolvedValue(updatedReport)

    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).report.status).toBe('SUBMITTED')
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

    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).report.status).toBe('SUBMITTED')
    expect(mockExpenseReportUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'exp-1', status: { in: ['DRAFT', 'REJECTED'] } }),
        data: expect.objectContaining({ status: 'SUBMITTED' }),
      }),
    )
  })

  it('should write audit log with lineItemsReplaced and lineItemCount', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue(BASE_REPORT)
    const updatedReport = { ...BASE_REPORT, lineItems: [{ id: 'li-1', category: 'MEALS', amount: 50 }] }
    mockExpenseReportUpdate.mockResolvedValue(updatedReport)

    await PATCH(makePatchRequest({
      lineItems: [{ date: '2025-02-01', category: 'MEALS', amount: 50 }],
    }), PARAMS)

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ExpenseReport',
        entityId: 'exp-1',
        action: 'UPDATE',
        after: expect.objectContaining({ lineItemsReplaced: true, lineItemCount: 1 }),
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

  it('should return 422 when employee has no manager', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'DRAFT' })
    mockEmployeeFindUnique.mockResolvedValue({ id: 'emp-1', manager: null })

    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)

    expect(res._status).toBe(422)
  })

  it('should start workflow instance when submitting', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'DRAFT' })

    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)

    expect(res._status).toBe(200)
    expect(mockStartInstance).toHaveBeenCalledWith(
      'expense-approval',
      expect.objectContaining({ expenseId: 'exp-1', employeeId: 'emp-1', managerId: 'user-mgr' }),
      expect.any(String),
    )
    expect(mockExpenseReportUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['DRAFT', 'REJECTED'] } }),
        data: expect.objectContaining({ status: 'SUBMITTED', workflowInstanceId: 'wf-instance-1' }),
      }),
    )
  })

  it('should return 409 and cancel the orphaned instance when concurrent submission wins the race (updateMany count=0)', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'REJECTED' })
    mockExpenseReportUpdateMany.mockResolvedValue({ count: 0 })

    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)

    expect(res._status).toBe(409)
    expect(mockExpenseReportFindUniqueInTx).not.toHaveBeenCalled()
    expect(mockCancelInstance).toHaveBeenCalledWith('wf-instance-1')
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ExpenseReport',
        entityId: 'exp-1',
        action: 'CONFLICT',
        before: { status: 'REJECTED' },
        after: expect.objectContaining({ conflict: true, workflowInstanceId: 'wf-instance-1' }),
      }),
    )
  })

  it('should still return 409 when cancelInstance fails (best-effort)', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'REJECTED' })
    mockExpenseReportUpdateMany.mockResolvedValue({ count: 0 })
    mockCancelInstance.mockRejectedValue(new Error('workflow service unavailable'))

    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)

    expect(res._status).toBe(409)
    expect(mockCancelInstance).toHaveBeenCalledWith('wf-instance-1')
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CONFLICT' }),
    )
  })

  it('should still return 409 when createAuditLog fails on conflict path (best-effort)', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'REJECTED' })
    mockExpenseReportUpdateMany.mockResolvedValue({ count: 0 })
    mockCreateAuditLog.mockRejectedValue(new Error('db unavailable'))

    const res = await PATCH(makePatchRequest({ status: 'SUBMITTED' }), PARAMS)

    expect(res._status).toBe(409)
  })

  it('should not start workflow when only line items are patched', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockExpenseReportFindUnique.mockResolvedValue({ ...BASE_REPORT, status: 'DRAFT' })
    mockExpenseReportUpdate.mockResolvedValue({
      ...BASE_REPORT,
      lineItems: [{ id: 'li-1', category: 'MEALS', amount: 50 }],
    })

    const res = await PATCH(makePatchRequest({
      lineItems: [{ date: '2025-02-01', category: 'MEALS', amount: 50 }],
    }), PARAMS)

    expect(mockStartInstance).not.toHaveBeenCalled()
    expect(res._status).toBe(200)
  })
})
