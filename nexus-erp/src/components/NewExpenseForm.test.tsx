// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import React from 'react'

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
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

import NewExpenseForm from './NewExpenseForm'

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderForm() {
  return render(<NewExpenseForm />)
}

/** Fill the date picker for item at position `index` (0-based). */
function fillDate(index: number, value = '2024-03-01') {
  const pickers = screen.getAllByLabelText('fields.date')
  fireEvent.change(pickers[index], { target: { value } })
}

/** Select a category for item at position `index`. */
function fillCategory(index: number, value = 'TRAVEL') {
  const selects = screen.getAllByRole('combobox', { name: /fields\.category/i })
  fireEvent.mouseDown(selects[index])
  fireEvent.click(screen.getByRole('option', { name: `categories.${value}` }))
}

/** Fill the amount field for item at position `index`. */
function fillAmount(index: number, value = '50') {
  const amounts = screen.getAllByLabelText(/fields\.amount/i)
  fireEvent.change(amounts[index], { target: { value } })
}

/** Fill all required fields for item at position `index`. */
function fillItem(index = 0, amount = '50') {
  fillDate(index)
  fillCategory(index)
  fillAmount(index, amount)
}

function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: /submit/i }))
}

function makeFile(name = 'receipt.pdf', size = 1024): File {
  const f = new File(['x'.repeat(size)], name, { type: 'application/pdf' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NewExpenseForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => Math.random().toString(36).slice(2)) })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Rendering ────────────────────────────────────────────────────────────────

  it('renders with one line item by default', () => {
    renderForm()
    expect(screen.getByLabelText('fields.date')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /fields\.category/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/fields\.amount/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fields\.description/i)).toBeInTheDocument()
  })

  it('renders the submit and cancel buttons', () => {
    renderForm()
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /cancel/i })).toBeInTheDocument()
  })

  it('does not show a remove button when there is only one item', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: /removeItem/i })).not.toBeInTheDocument()
  })

  // ── Add / Remove items ───────────────────────────────────────────────────────

  it('adds a second line item when "Add Line Item" is clicked', () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /addItem/i }))
    expect(screen.getAllByLabelText('fields.date')).toHaveLength(2)
  })

  it('shows remove buttons for each item when there are multiple items', () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /addItem/i }))
    expect(screen.getAllByRole('button', { name: /removeItem/i })).toHaveLength(2)
  })

  it('removes the correct item when the remove button is clicked', () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /addItem/i }))
    // Two items now; remove the first one
    const removeButtons = screen.getAllByRole('button', { name: /removeItem/i })
    fireEvent.click(removeButtons[0])
    expect(screen.getAllByLabelText('fields.date')).toHaveLength(1)
  })

  // ── Validation ───────────────────────────────────────────────────────────────

  it('shows date required error when date is empty on submit', async () => {
    renderForm()
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.dateRequired')).toBeInTheDocument()
    })
  })

  it('shows category required error when category is empty on submit', async () => {
    renderForm()
    fillDate(0)
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.categoryRequired')).toBeInTheDocument()
    })
  })

  it('shows amount required error when amount is empty on submit', async () => {
    renderForm()
    fillDate(0)
    fillCategory(0)
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.amountRequired')).toBeInTheDocument()
    })
  })

  it('shows amount invalid error when amount is zero on submit', async () => {
    renderForm()
    fillDate(0)
    fillCategory(0)
    fillAmount(0, '0')
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.amountInvalid')).toBeInTheDocument()
    })
  })

  it('shows amount invalid error when amount is negative on submit', async () => {
    renderForm()
    fillDate(0)
    fillCategory(0)
    fillAmount(0, '-5')
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.amountInvalid')).toBeInTheDocument()
    })
  })

  it('clears a field error when the user edits the errored field', async () => {
    renderForm()
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.dateRequired')).toBeInTheDocument()
    })
    fillDate(0)
    await waitFor(() => {
      expect(screen.queryByText('validation.dateRequired')).not.toBeInTheDocument()
    })
  })

  // ── fieldErrors re-indexed after item removal ────────────────────────────────

  it('moves error from item-1 to item-0 after item-0 is removed', async () => {
    renderForm()
    // Add a second item
    fireEvent.click(screen.getByRole('button', { name: /addItem/i }))
    // Fill item-0 fully but leave item-1 empty → submit triggers error on item-1
    fillDate(0)
    fillCategory(0)
    fillAmount(0)
    submitForm()
    await waitFor(() => {
      // item-1 should have errors
      expect(screen.getAllByText('validation.dateRequired')).toHaveLength(1)
    })
    // Remove item-0; what was item-1 is now item-0; its error should still be shown
    const removeButtons = screen.getAllByRole('button', { name: /removeItem/i })
    fireEvent.click(removeButtons[0])
    await waitFor(() => {
      expect(screen.getByText('validation.dateRequired')).toBeInTheDocument()
    })
  })

  // ── File size validation ──────────────────────────────────────────────────────

  it('shows fileTooLarge error when an oversized file is selected', async () => {
    renderForm()
    const oversizeFile = makeFile('big.pdf', 11 * 1024 * 1024)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [oversizeFile] } })
    await waitFor(() => {
      expect(screen.getByText('validation.fileTooLarge')).toBeInTheDocument()
    })
  })

  it('accepts a file within the 10 MB limit', async () => {
    renderForm()
    const smallFile = makeFile('receipt.pdf', 5 * 1024 * 1024)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [smallFile] } })
    await waitFor(() => {
      expect(screen.queryByText('validation.fileTooLarge')).not.toBeInTheDocument()
    })
    // The button label should update to show the file name
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument()
  })

  // ── Successful submission ─────────────────────────────────────────────────────

  it('POSTs to /api/expenses and redirects to the new report on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ report: { id: 'rpt-1' } }),
    } as Response)

    renderForm()
    fillItem()
    submitForm()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce()
    })

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/expenses')
    expect((options as RequestInit).method).toBe('POST')

    const body = JSON.parse((options as RequestInit).body as string)
    expect(body.lineItems).toHaveLength(1)
    expect(body.lineItems[0]).toMatchObject({
      date: '2024-03-01',
      category: 'TRAVEL',
      amount: 50,
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/expenses/rpt-1')
    })
  })

  it('uploads receipt after creating the report and redirects when upload succeeds', async () => {
    // First call: create report; second call: upload receipt
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ report: { id: 'rpt-2' } }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)

    renderForm()
    fillItem()

    // Attach a receipt file
    const file = makeFile('receipt.pdf', 1024)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })

    submitForm()

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/expenses/rpt-2')
    })

    // Verify the receipt was uploaded to the correct endpoint
    const uploadCall = vi.mocked(fetch).mock.calls[1]
    expect(uploadCall[0]).toBe('/api/expenses/rpt-2/receipts')
    expect((uploadCall[1] as RequestInit).method).toBe('POST')
  })

  // ── Receipt upload failure → retry banner ────────────────────────────────────

  it('shows retry banner when receipt upload fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ report: { id: 'rpt-3' } }),
      } as Response)
      .mockResolvedValueOnce({ ok: false } as Response)

    renderForm()
    fillItem()

    const file = makeFile('receipt.pdf', 1024)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })

    submitForm()

    await waitFor(() => {
      expect(screen.getByText('receiptUploadFailed')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /retryUpload/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /viewReport/i })).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('navigates to the report after a successful retry', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ report: { id: 'rpt-4' } }),
      } as Response)
      // First upload attempt fails
      .mockResolvedValueOnce({ ok: false } as Response)
      // Retry succeeds
      .mockResolvedValueOnce({ ok: true } as Response)

    renderForm()
    fillItem()

    const file = makeFile('receipt.pdf', 1024)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })

    submitForm()

    // Wait for retry banner to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retryUpload/i })).toBeInTheDocument()
    })

    // Click retry
    fireEvent.click(screen.getByRole('button', { name: /retryUpload/i }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/expenses/rpt-4')
    })
  })

  it('keeps the retry banner when retry still fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ report: { id: 'rpt-5' } }),
      } as Response)
      // First upload attempt fails
      .mockResolvedValueOnce({ ok: false } as Response)
      // Retry also fails
      .mockResolvedValueOnce({ ok: false } as Response)

    renderForm()
    fillItem()

    const file = makeFile('receipt.pdf', 1024)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })

    submitForm()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retryUpload/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /retryUpload/i }))

    await waitFor(() => {
      // Banner still present after failed retry
      expect(screen.getByText('receiptUploadFailed')).toBeInTheDocument()
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  // ── Server error ──────────────────────────────────────────────────────────────

  it('shows a server error alert when the API returns an error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' }),
    } as Response)

    renderForm()
    fillItem()
    submitForm()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Internal Server Error')
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('shows "Error 500" when the error body has no error field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    renderForm()
    fillItem()
    submitForm()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error 500')
    })
  })

  // ── Submit button disabled while submitting ───────────────────────────────────

  it('disables the submit button and shows submitting label while in flight', async () => {
    let resolveFetch!: (v: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderForm()
    fillItem()
    submitForm()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled()
    })

    // Resolve so the component finishes its async work before cleanup
    resolveFetch({
      ok: true,
      json: async () => ({ report: { id: 'rpt-x' } }),
    } as Response)
  })
})
