// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// ── Component import (after mocks) ────────────────────────────────────────────

import NewEmployeeForm from './NewEmployeeForm'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NO_DEPARTMENTS: { id: string; name: string }[] = []
const NO_MANAGERS: { id: string; fullName: string }[] = []

const DEPARTMENTS = [
  { id: 'dept-1', name: 'Engineering' },
  { id: 'dept-2', name: 'Marketing' },
]

const MANAGERS = [
  { id: 'mgr-1', fullName: 'Alice Manager' },
  { id: 'mgr-2', fullName: 'Bob Lead' },
]

function renderForm(
  managers = NO_MANAGERS,
  departments = NO_DEPARTMENTS,
) {
  return render(<NewEmployeeForm managers={managers} departments={departments} />)
}

// Fill required fields using the translated key labels (useTranslations returns key as-is)
function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/fields\.fullName/i), {
    target: { value: 'Jane Doe' },
  })
  fireEvent.change(screen.getByLabelText(/fields\.email/i), {
    target: { value: 'jane@example.com' },
  })
  fireEvent.change(screen.getByLabelText(/fields\.password/i), {
    target: { value: 'password123' },
  })
  fireEvent.change(screen.getByLabelText(/fields\.hireDate/i), {
    target: { value: '2024-01-15' },
  })
}

function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: /submit/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NewEmployeeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('should render fullName, email, password, and hireDate fields', () => {
    renderForm()
    expect(screen.getByLabelText(/fields\.fullName/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fields\.email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fields\.password/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fields\.hireDate/i)).toBeInTheDocument()
  })

  // ── Client-side validation ───────────────────────────────────────────────────

  it('should show a validation error when fullName is empty on submit', async () => {
    renderForm()
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.fullNameRequired')).toBeInTheDocument()
    })
  })

  it('should show a validation error when email is empty on submit', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/fields\.fullName/i), {
      target: { value: 'Jane Doe' },
    })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.emailRequired')).toBeInTheDocument()
    })
  })

  it('should show a validation error when email format is invalid on submit', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/fields\.fullName/i), {
      target: { value: 'Jane Doe' },
    })
    fireEvent.change(screen.getByLabelText(/fields\.email/i), {
      target: { value: 'not-an-email' },
    })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.emailInvalid')).toBeInTheDocument()
    })
  })

  it('should show a validation error when password is empty on submit', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/fields\.fullName/i), {
      target: { value: 'Jane Doe' },
    })
    fireEvent.change(screen.getByLabelText(/fields\.email/i), {
      target: { value: 'jane@example.com' },
    })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.passwordRequired')).toBeInTheDocument()
    })
  })

  it('should show a validation error when password is less than 8 characters on submit', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/fields\.fullName/i), {
      target: { value: 'Jane Doe' },
    })
    fireEvent.change(screen.getByLabelText(/fields\.email/i), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/fields\.password/i), {
      target: { value: 'short' },
    })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.passwordMinLength')).toBeInTheDocument()
    })
  })

  it('should show a validation error when hireDate is empty on submit', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/fields\.fullName/i), {
      target: { value: 'Jane Doe' },
    })
    fireEvent.change(screen.getByLabelText(/fields\.email/i), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/fields\.password/i), {
      target: { value: 'password123' },
    })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.hireDateRequired')).toBeInTheDocument()
    })
  })

  it('should clear a field error when the user starts typing in the errored field', async () => {
    renderForm()
    // Trigger validation error for fullName
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('validation.fullNameRequired')).toBeInTheDocument()
    })
    // Start typing — error should disappear
    fireEvent.change(screen.getByLabelText(/fields\.fullName/i), {
      target: { value: 'J' },
    })
    await waitFor(() => {
      expect(screen.queryByText('validation.fullNameRequired')).not.toBeInTheDocument()
    })
  })

  // ── Successful submission ────────────────────────────────────────────────────

  it('should call fetch with the correct body and redirect to /employees/[id] on 201', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ employee: { id: 'emp-123' } }),
    } as Response)

    renderForm()
    fillRequiredFields()
    submitForm()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce()
    })

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/employees')
    expect((options as RequestInit).method).toBe('POST')

    const sentBody = JSON.parse((options as RequestInit).body as string)
    expect(sentBody).toMatchObject({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      password: 'password123',
      hireDate: '2024-01-15',
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/employees/emp-123')
    })
  })

  // ── 409 conflict ────────────────────────────────────────────────────────────

  it('should show an email inline error on 409 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({}),
    } as Response)

    renderForm()
    fillRequiredFields()
    submitForm()

    await waitFor(() => {
      expect(screen.getByText('validation.emailInUse')).toBeInTheDocument()
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  // ── Generic server error ─────────────────────────────────────────────────────

  it('should show a server Alert with the error message on a generic server error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    } as Response)

    renderForm()
    fillRequiredFields()
    submitForm()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Server error')
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  // ── Submit button disabled while submitting ──────────────────────────────────

  it('should disable the submit button while submitting', async () => {
    // Hold the fetch in-flight so we can assert the disabled state
    let resolveFetch!: (v: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderForm()
    fillRequiredFields()
    submitForm()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled()
    })

    // Resolve the pending request so the component can finish cleanup
    resolveFetch({
      ok: true,
      status: 201,
      json: async () => ({ employee: { id: 'emp-1' } }),
    } as Response)
  })

  // ── Props: departments and managers ─────────────────────────────────────────

  it('should render department options in the Department select', async () => {
    renderForm(NO_MANAGERS, DEPARTMENTS)
    // Open the department select to make the MenuItem options visible in the DOM
    const departmentSelect = screen.getByRole('combobox', { name: /fields\.department/i })
    fireEvent.mouseDown(departmentSelect)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Engineering' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Marketing' })).toBeInTheDocument()
    })
  })

  it('should render manager options in the Manager select', async () => {
    renderForm(MANAGERS, NO_DEPARTMENTS)
    // Open the manager select to make the MenuItem options visible in the DOM
    const managerSelect = screen.getByRole('combobox', { name: /fields\.manager/i })
    fireEvent.mouseDown(managerSelect)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Alice Manager' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Bob Lead' })).toBeInTheDocument()
    })
  })
})
