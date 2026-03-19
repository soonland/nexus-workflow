// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import React from 'react'

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockPush = vi.fn()
const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// Mock DatePicker with a simple text input so we can interact with it in tests
vi.mock('@mui/x-date-pickers/DatePicker', () => ({
  DatePicker: ({ label, onChange, slotProps }: {
    label: string
    value: unknown
    onChange: (val: { isValid: () => boolean; format: (f: string) => string } | null) => void
    disabled?: boolean
    slotProps?: {
      textField?: {
        error?: boolean
        helperText?: string
        required?: boolean
        fullWidth?: boolean
        size?: string
      }
    }
  }) => {
    const tf = slotProps?.textField ?? {}
    return (
      <div>
        <input
          aria-label={label}
          type="text"
          aria-required={tf.required}
          aria-invalid={tf.error}
          onChange={(e) => {
            const v = e.target.value
            if (!v) { onChange(null); return }
            onChange({ isValid: () => true, format: (f: string) => (f === 'YYYY-MM-DD' ? v : v) })
          }}
        />
        {tf.helperText && <span>{tf.helperText}</span>}
      </div>
    )
  },
}))

vi.mock('@mui/x-date-pickers/LocalizationProvider', () => ({
  LocalizationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@mui/x-date-pickers/AdapterDayjs', () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  AdapterDayjs: class AdapterDayjs {},
}))

// ── Component import (after mocks) ────────────────────────────────────────────

import ExpenseDetailView from './ExpenseDetailView'

// ── Sample data ───────────────────────────────────────────────────────────────

const baseReport = {
  id: 'rep-1',
  status: 'SUBMITTED',
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:00:00.000Z',
  employeeId: 'emp-1',
  lineItems: [
    { id: 'li-1', date: '2024-01-10', category: 'TRAVEL', amount: 100.00, description: 'Flight' },
    { id: 'li-2', date: '2024-01-11', category: 'MEALS', amount: 25.50, description: null },
  ],
  auditLogs: [
    { id: 'al-1', action: 'CREATE', actorName: 'alice@example.com', createdAt: '2024-01-15T10:00:00.000Z', before: null, after: { status: 'DRAFT' } },
  ],
}

const rejectedReport = {
  ...baseReport,
  status: 'REJECTED',
  auditLogs: [
    ...baseReport.auditLogs,
    { id: 'al-2', action: 'UPDATE', actorName: 'manager@example.com', createdAt: '2024-01-16T09:00:00.000Z', before: { status: 'SUBMITTED' }, after: { status: 'REJECTED', comment: 'Missing receipts' } },
  ],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderView(overrides: {
  report?: typeof baseReport
  isOwner?: boolean
  title?: string
} = {}) {
  const props = {
    report: baseReport,
    isOwner: true,
    title: 'Expense Report #1',
    ...overrides,
  }
  return render(<ExpenseDetailView {...props} />)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ExpenseDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => Math.random().toString(36).slice(2)) })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── View mode: line items table ───────────────────────────────────────────────

  describe('view mode', () => {
    it('renders line items table with correct data', () => {
      renderView()

      // Dates
      expect(screen.getByText('2024-01-10')).toBeInTheDocument()
      expect(screen.getByText('2024-01-11')).toBeInTheDocument()

      // Categories (translated via (key) => key)
      expect(screen.getByText('categories.TRAVEL')).toBeInTheDocument()
      expect(screen.getByText('categories.MEALS')).toBeInTheDocument()

      // Amounts formatted to 2 decimal places
      expect(screen.getByText('100.00')).toBeInTheDocument()
      expect(screen.getByText('25.50')).toBeInTheDocument()

      // Description present; null description shows em dash
      expect(screen.getByText('Flight')).toBeInTheDocument()
      expect(screen.getByText('—')).toBeInTheDocument()

      // Total: 100 + 25.5 = 125.50
      expect(screen.getByText('125.50')).toBeInTheDocument()
    })

    it('renders the status chip with the translated status label', () => {
      renderView()
      // The chip label is tStatus(status) which returns the key: 'SUBMITTED'
      expect(screen.getByText('SUBMITTED')).toBeInTheDocument()
    })

    it('shows audit trail entries with actor name and action chip', () => {
      renderView()

      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
      // Action chip
      expect(screen.getByText('CREATE')).toBeInTheDocument()
    })

    it('does not show the rejection banner when status is not REJECTED', () => {
      renderView()
      // The banner contains the 'rejectionReason' key translation
      expect(screen.queryByText('rejectionReason')).not.toBeInTheDocument()
    })

    it('does not show the resubmit button when status is not REJECTED', () => {
      renderView()
      expect(screen.queryByRole('button', { name: /resubmit/i })).not.toBeInTheDocument()
    })
  })

  // ── REJECTED status ───────────────────────────────────────────────────────────

  describe('when status is REJECTED', () => {
    it('shows rejection banner containing the rejectionReason translation key', () => {
      renderView({ report: rejectedReport })
      expect(screen.getByText('rejectionReason')).toBeInTheDocument()
    })

    it('shows the rejection comment from the audit log', () => {
      renderView({ report: rejectedReport })
      expect(screen.getByText('Missing receipts')).toBeInTheDocument()
    })

    it('shows the resubmit button when isOwner is true', () => {
      renderView({ report: rejectedReport, isOwner: true })
      expect(screen.getByRole('button', { name: 'resubmit' })).toBeInTheDocument()
    })

    it('does NOT show the resubmit button when isOwner is false', () => {
      renderView({ report: rejectedReport, isOwner: false })
      expect(screen.queryByRole('button', { name: 'resubmit' })).not.toBeInTheDocument()
    })

    it('shows both audit trail entries', () => {
      renderView({ report: rejectedReport })
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
      expect(screen.getByText('manager@example.com')).toBeInTheDocument()
      expect(screen.getByText('CREATE')).toBeInTheDocument()
      expect(screen.getByText('UPDATE')).toBeInTheDocument()
    })
  })

  // ── Edit mode ─────────────────────────────────────────────────────────────────

  describe('edit mode (after clicking resubmit)', () => {
    function enterEditMode() {
      renderView({ report: rejectedReport, isOwner: true })
      fireEvent.click(screen.getByRole('button', { name: 'resubmit' }))
    }

    it('clicking resubmit button switches to edit form mode', () => {
      enterEditMode()
      // Edit form shows date pickers (mocked as inputs) and submit/cancel buttons
      expect(screen.getAllByLabelText('fields.date')).toHaveLength(2)
      expect(screen.getByRole('button', { name: 'submitResubmit' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'cancelEdit' })).toBeInTheDocument()
    })

    it('clicking cancel returns to view mode', () => {
      enterEditMode()
      fireEvent.click(screen.getByRole('button', { name: 'cancelEdit' }))
      // Back in view mode: the table is shown, no date picker inputs
      expect(screen.queryByLabelText('fields.date')).not.toBeInTheDocument()
      // Line items table values visible again
      expect(screen.getByText('2024-01-10')).toBeInTheDocument()
    })

    it('shows date required validation error when date is blank on submit', async () => {
      // Use a report with a single line item that has no date set by adding a new blank item
      const reportWithOneItem = {
        ...rejectedReport,
        lineItems: [rejectedReport.lineItems[0]],
      }
      renderView({ report: reportWithOneItem, isOwner: true })
      fireEvent.click(screen.getByRole('button', { name: 'resubmit' }))

      // Wait for edit form to appear
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'submitResubmit' })).toBeInTheDocument()
      })

      // Add a new line item — it starts with date: null
      fireEvent.click(screen.getByRole('button', { name: 'addItem' }))

      // Fill in the second item fully except date (leave it null) — but to trigger
      // validation for the null-date item we only need to fill in the first item and submit.
      // The second item will have date=null, category='', amount='' — all will fail.
      // We care specifically that dateRequired appears.
      fireEvent.click(screen.getByRole('button', { name: 'submitResubmit' }))

      await waitFor(() => {
        expect(screen.getByText('validation.dateRequired')).toBeInTheDocument()
      })
      // fetch should not have been called
      expect(fetch).not.toHaveBeenCalled()
    })

    it('PATCHes /api/expenses/:id with lineItems and status SUBMITTED on valid submit', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response)

      enterEditMode()

      // The date pickers pre-populate from existing line items via dayjs, but our mock
      // DatePicker does not reflect an initial value in the input — we must fire a change
      // to feed a valid date object back through onChange for each item.
      const datePickers = screen.getAllByLabelText('fields.date')
      fireEvent.change(datePickers[0], { target: { value: '2024-01-10' } })
      fireEvent.change(datePickers[1], { target: { value: '2024-01-11' } })

      fireEvent.click(screen.getByRole('button', { name: 'submitResubmit' }))

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledOnce()
      })

      const [url, options] = vi.mocked(fetch).mock.calls[0]
      expect(url).toBe('/api/expenses/rep-1')
      expect((options as RequestInit).method).toBe('PATCH')

      const body = JSON.parse((options as RequestInit).body as string)
      expect(body.status).toBe('SUBMITTED')
      expect(body.lineItems).toHaveLength(2)
      expect(body.lineItems[0]).toMatchObject({
        date: '2024-01-10',
        category: 'TRAVEL',
        amount: 100,
      })
      expect(body.lineItems[1]).toMatchObject({
        date: '2024-01-11',
        category: 'MEALS',
        amount: 25.5,
      })
    })

    it('navigates to /expenses after a successful PATCH', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response)

      enterEditMode()

      const datePickers = screen.getAllByLabelText('fields.date')
      fireEvent.change(datePickers[0], { target: { value: '2024-01-10' } })
      fireEvent.change(datePickers[1], { target: { value: '2024-01-11' } })

      fireEvent.click(screen.getByRole('button', { name: 'submitResubmit' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/expenses')
      })
      expect(mockRefresh).toHaveBeenCalled()
    })

    it('shows server error alert and stays in edit mode when PATCH fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ error: 'Invalid line items' }),
      } as Response)

      enterEditMode()

      const datePickers = screen.getAllByLabelText('fields.date')
      fireEvent.change(datePickers[0], { target: { value: '2024-01-10' } })
      fireEvent.change(datePickers[1], { target: { value: '2024-01-11' } })

      fireEvent.click(screen.getByRole('button', { name: 'submitResubmit' }))

      // There are two alerts: the rejection banner and the server error.
      // We verify the server error text appears somewhere in the document.
      await waitFor(() => {
        expect(screen.getByText('Invalid line items')).toBeInTheDocument()
      })

      // Still in edit mode
      expect(screen.getByRole('button', { name: 'submitResubmit' })).toBeInTheDocument()
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('shows server error alert when PATCH response has no error field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response)

      enterEditMode()

      const datePickers = screen.getAllByLabelText('fields.date')
      fireEvent.change(datePickers[0], { target: { value: '2024-01-10' } })
      fireEvent.change(datePickers[1], { target: { value: '2024-01-11' } })

      fireEvent.click(screen.getByRole('button', { name: 'submitResubmit' }))

      await waitFor(() => {
        expect(screen.getByText('Error 500')).toBeInTheDocument()
      })
    })
  })
})
