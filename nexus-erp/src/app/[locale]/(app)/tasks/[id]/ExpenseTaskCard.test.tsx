// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ExpenseReportStatus, ExpenseLineItemCategory } from '@prisma/client'
import type { Employee, ExpenseLineItem, ExpenseReport, User } from '@prisma/client'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}))

// ── Component import (after mocks) ────────────────────────────────────────────

import ExpenseTaskCard from './ExpenseTaskCard'

// ── Fixtures ──────────────────────────────────────────────────────────────────

type Report = ExpenseReport & {
  employee: Employee & { user: Pick<User, 'email'> }
  lineItems: ExpenseLineItem[]
}

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report-1',
    employeeId: 'emp-1',
    status: ExpenseReportStatus.SUBMITTED,
    workflowInstanceId: null,
    receiptPath: '/receipts/report-1.pdf',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    employee: {
      id: 'emp-1',
      userId: 'user-1',
      fullName: 'Alice Martin',
      departmentId: null,
      hireDate: new Date('2020-06-01T00:00:00Z'),
      managerId: null,
      phone: null,
      street: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
      createdAt: new Date('2020-06-01T00:00:00Z'),
      updatedAt: new Date('2020-06-01T00:00:00Z'),
      user: { email: 'alice@example.com' },
    },
    lineItems: [
      {
        id: 'item-1',
        reportId: 'report-1',
        // Use noon UTC to avoid toLocaleDateString shifting dates backwards in
        // environments that run at UTC-N offsets
        date: new Date('2025-01-15T12:00:00Z'),
        category: ExpenseLineItemCategory.TRAVEL,
        amount: 150.75 as unknown as import('@prisma/client').Prisma.Decimal,
        description: 'Flight to Paris',
        createdAt: new Date('2025-01-15T12:00:00Z'),
        updatedAt: new Date('2025-01-15T12:00:00Z'),
      },
      {
        id: 'item-2',
        reportId: 'report-1',
        date: new Date('2025-01-16T12:00:00Z'),
        category: ExpenseLineItemCategory.MEALS,
        amount: 42.5 as unknown as import('@prisma/client').Prisma.Decimal,
        description: 'Client dinner',
        createdAt: new Date('2025-01-16T12:00:00Z'),
        updatedAt: new Date('2025-01-16T12:00:00Z'),
      },
    ],
    ...overrides,
  }
}

async function renderCard(report: Report) {
  // ExpenseTaskCard is an async Server Component — call it as a function to get
  // the resolved JSX, then render that synchronously with React Testing Library.
  const jsx = await ExpenseTaskCard({ report })
  return render(jsx as React.ReactElement)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ExpenseTaskCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  // ── Employee identity ──────────────────────────────────────────────────────

  it('should render the employee full name', async () => {
    await renderCard(makeReport())
    expect(screen.getByText(/Alice Martin/)).toBeInTheDocument()
  })

  it('should render the employee email', async () => {
    await renderCard(makeReport())
    expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument()
  })

  // ── Status badge ──────────────────────────────────────────────────────────

  it('should render a status chip using the translated status key', async () => {
    // Translation mock returns the key as-is, so we expect "status.SUBMITTED"
    await renderCard(makeReport({ status: ExpenseReportStatus.SUBMITTED }))
    expect(screen.getByText('status.SUBMITTED')).toBeInTheDocument()
  })

  it.each([
    ExpenseReportStatus.DRAFT,
    ExpenseReportStatus.APPROVED_MANAGER,
    ExpenseReportStatus.APPROVED_ACCOUNTING,
    ExpenseReportStatus.REJECTED,
    ExpenseReportStatus.REIMBURSED,
  ])('should render status chip for status %s', async (status) => {
    await renderCard(makeReport({ status }))
    expect(screen.getByText(`status.${status}`)).toBeInTheDocument()
  })

  // ── Line items ─────────────────────────────────────────────────────────────

  it('should render translated category labels for each line item', async () => {
    await renderCard(makeReport())
    // Each category appears twice: once in desktop grid, once in mobile stack
    expect(screen.getAllByText('category.TRAVEL').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('category.MEALS').length).toBeGreaterThanOrEqual(1)
  })

  it('should render the formatted amount for each line item', async () => {
    await renderCard(makeReport())
    expect(screen.getAllByText('$150.75').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('$42.50').length).toBeGreaterThanOrEqual(1)
  })

  it('should render the formatted date for each line item (en-GB locale)', async () => {
    await renderCard(makeReport())
    // 2025-01-15 → "15 Jan 2025", 2025-01-16 → "16 Jan 2025"
    expect(screen.getAllByText('15 Jan 2025').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('16 Jan 2025').length).toBeGreaterThanOrEqual(1)
  })

  it('should render the description text for each line item that has one', async () => {
    await renderCard(makeReport())
    expect(screen.getByText('Flight to Paris')).toBeInTheDocument()
    expect(screen.getByText('Client dinner')).toBeInTheDocument()
  })

  it('should render "—" for a line item with no description', async () => {
    const report = makeReport({
      lineItems: [
        {
          id: 'item-null-desc',
          reportId: 'report-1',
          date: new Date('2025-02-01T00:00:00Z'),
          category: ExpenseLineItemCategory.OTHER,
          amount: 10 as unknown as import('@prisma/client').Prisma.Decimal,
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    await renderCard(report)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  // ── Total calculation ──────────────────────────────────────────────────────

  it('should display the sum of all line item amounts as the total', async () => {
    // 150.75 + 42.50 = 193.25
    await renderCard(makeReport())
    expect(screen.getByText('total: $193.25')).toBeInTheDocument()
  })

  it('should display $0.00 total when there are no line items', async () => {
    await renderCard(makeReport({ lineItems: [] }))
    expect(screen.getByText('total: $0.00')).toBeInTheDocument()
  })

  // ── Receipt link ──────────────────────────────────────────────────────────

  it('should render a receipt link pointing to receiptPath when present', async () => {
    await renderCard(makeReport({ receiptPath: '/receipts/report-1.pdf' }))
    const link = screen.getByRole('link', { name: 'viewReceipt' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/receipts/report-1.pdf')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('should not render a receipt link when receiptPath is null', async () => {
    await renderCard(makeReport({ receiptPath: null }))
    expect(screen.queryByRole('link', { name: 'viewReceipt' })).not.toBeInTheDocument()
  })

  // ── Empty line items ───────────────────────────────────────────────────────

  it('should render no line item rows when lineItems is empty', async () => {
    await renderCard(makeReport({ lineItems: [] }))
    // No per-item amounts should be present (the footer total "$0.00" still renders,
    // so we check for the absence of any non-zero line item amount)
    expect(screen.queryByText('$150.75')).not.toBeInTheDocument()
    expect(screen.queryByText('$42.50')).not.toBeInTheDocument()
    // No category keys should be present
    expect(screen.queryByText(/category\./)).not.toBeInTheDocument()
  })

  it('should still render the column headers (date, category, amount, description) when lineItems is empty', async () => {
    await renderCard(makeReport({ lineItems: [] }))
    expect(screen.getByText('columns.date')).toBeInTheDocument()
    expect(screen.getByText('columns.category')).toBeInTheDocument()
    expect(screen.getByText('columns.amount')).toBeInTheDocument()
    expect(screen.getByText('columns.description')).toBeInTheDocument()
  })
})
