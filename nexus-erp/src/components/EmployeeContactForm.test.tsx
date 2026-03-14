// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockRefresh = vi.fn()
const mockShowSnackbar = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/components/SnackbarContext', () => ({
  useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}))

// ── Component import ──────────────────────────────────────────────────────────

import EmployeeContactForm from './EmployeeContactForm'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_VALUES = {
  phone: '+1 555 000 0001',
  street: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'USA',
}

const PENDING_REQUEST = {
  id: 'req-1',
  createdAt: '2024-02-10T00:00:00Z',
  phone: '+1 555 999 0000',
  street: '456 Oak Ave',
  city: 'Shelbyville',
  state: 'IL',
  postalCode: '62565',
  country: 'USA',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EmployeeContactForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Rendering ─────────────────────────────────────────────────────────────────

  it('renders all contact fields pre-filled with default values', () => {
    render(<EmployeeContactForm employeeId="emp-1" defaultValues={DEFAULT_VALUES} />)
    expect(screen.getByDisplayValue('+1 555 000 0001')).toBeInTheDocument()
    expect(screen.getByDisplayValue('123 Main St')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Springfield')).toBeInTheDocument()
    expect(screen.getByDisplayValue('IL')).toBeInTheDocument()
    expect(screen.getByDisplayValue('62701')).toBeInTheDocument()
    expect(screen.getByDisplayValue('USA')).toBeInTheDocument()
  })

  it('renders the Submit for Review button', () => {
    render(<EmployeeContactForm employeeId="emp-1" defaultValues={DEFAULT_VALUES} />)
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeInTheDocument()
  })

  // ── Pending request banner ────────────────────────────────────────────────────

  it('shows a pending review banner when pendingRequest is provided', () => {
    render(
      <EmployeeContactForm
        employeeId="emp-1"
        defaultValues={DEFAULT_VALUES}
        pendingRequest={PENDING_REQUEST}
      />,
    )
    expect(screen.getByText(/pending hr review/i)).toBeInTheDocument()
    expect(screen.getByText(/in review/i)).toBeInTheDocument()
  })

  it('pre-fills fields with pending request values when pendingRequest is provided', () => {
    render(
      <EmployeeContactForm
        employeeId="emp-1"
        defaultValues={DEFAULT_VALUES}
        pendingRequest={PENDING_REQUEST}
      />,
    )
    expect(screen.getByDisplayValue('+1 555 999 0000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('456 Oak Ave')).toBeInTheDocument()
  })

  it('does not show the pending banner when pendingRequest is null', () => {
    render(<EmployeeContactForm employeeId="emp-1" defaultValues={DEFAULT_VALUES} pendingRequest={null} />)
    expect(screen.queryByText(/pending hr review/i)).not.toBeInTheDocument()
  })

  // ── Submission ────────────────────────────────────────────────────────────────

  it('POSTs to the profile-update-requests endpoint on submit', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)

    render(<EmployeeContactForm employeeId="emp-42" defaultValues={DEFAULT_VALUES} />)
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/employees/emp-42/profile-update-requests',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
      expect(mockRefresh).toHaveBeenCalledOnce()
    })
  })

  it('shows an error snackbar when submission fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    } as Response)

    render(<EmployeeContactForm employeeId="emp-42" defaultValues={DEFAULT_VALUES} />)
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }))

    await waitFor(() => {
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', message: 'Server error' }),
      )
    })
  })

  it('disables the submit button while saving', async () => {
    let resolve!: (v: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r }))

    render(<EmployeeContactForm employeeId="emp-42" defaultValues={DEFAULT_VALUES} />)
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled()
    })

    resolve({ ok: true } as Response)
  })

  // ── Field updates ─────────────────────────────────────────────────────────────

  it('updates the phone field when typed into', () => {
    render(<EmployeeContactForm employeeId="emp-1" defaultValues={DEFAULT_VALUES} />)
    const phoneInput = screen.getByDisplayValue('+1 555 000 0001')
    fireEvent.change(phoneInput, { target: { value: '+1 800 111 2222' } })
    expect(screen.getByDisplayValue('+1 800 111 2222')).toBeInTheDocument()
  })
})
