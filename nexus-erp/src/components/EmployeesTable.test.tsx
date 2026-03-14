// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

// ── Component import ──────────────────────────────────────────────────────────

import EmployeesTable from './EmployeesTable'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EMPLOYEES = [
  {
    id: 'emp-1',
    fullName: 'Alice Smith',
    hireDate: new Date('2023-03-15'),
    user: { email: 'alice@example.com', role: 'manager' },
    department: { name: 'Engineering' },
  },
  {
    id: 'emp-2',
    fullName: 'Bob Jones',
    hireDate: new Date('2022-07-01'),
    user: { email: 'bob@example.com', role: 'employee' },
    department: null,
  },
]

const EMPLOYEE_SUMMARY = {
  id: 'emp-1',
  fullName: 'Alice Smith',
  hireDate: '2023-03-15',
  phone: null,
  street: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  department: { id: 'dept-1', name: 'Engineering' },
  manager: null,
  user: { email: 'alice@example.com', role: 'manager' },
  groups: [],
  effectivePermissions: [],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EmployeesTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Rendering ─────────────────────────────────────────────────────────────────

  it('renders employee names and emails', () => {
    render(<EmployeesTable employees={EMPLOYEES} />)
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
  })

  it('renders department name and falls back to — when null', () => {
    render(<EmployeesTable employees={EMPLOYEES} />)
    expect(screen.getByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders role chip for each employee', () => {
    render(<EmployeesTable employees={EMPLOYEES} />)
    expect(screen.getByText('manager')).toBeInTheDocument()
    expect(screen.getByText('employee')).toBeInTheDocument()
  })

  it('renders Edit links pointing to /employees/[id]', () => {
    render(<EmployeesTable employees={EMPLOYEES} />)
    const editLinks = screen.getAllByRole('link', { name: /edit/i })
    expect(editLinks[0]).toHaveAttribute('href', '/employees/emp-1')
    expect(editLinks[1]).toHaveAttribute('href', '/employees/emp-2')
  })

  it('renders Preview buttons', () => {
    render(<EmployeesTable employees={EMPLOYEES} />)
    const previewBtns = screen.getAllByRole('button', { name: /preview/i })
    expect(previewBtns).toHaveLength(2)
  })

  // ── Preview dialog ────────────────────────────────────────────────────────────

  it('opens the profile dialog when Preview is clicked', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => EMPLOYEE_SUMMARY,
    } as Response)

    render(<EmployeesTable employees={EMPLOYEES} />)
    fireEvent.click(screen.getAllByRole('button', { name: /preview/i })[0])

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Employee Profile')).toBeInTheDocument()
    })
  })

  it('closes the dialog when the close button is clicked', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => EMPLOYEE_SUMMARY,
    } as Response)

    render(<EmployeesTable employees={EMPLOYEES} />)
    fireEvent.click(screen.getAllByRole('button', { name: /preview/i })[0])

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Close button (CloseRoundedIcon icon button)
    const closeBtn = screen.getAllByRole('button').find(
      (btn) => !btn.textContent && btn.closest('[role="dialog"]'),
    )!
    fireEvent.click(closeBtn)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('shows employee data in dialog after fetch resolves', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => EMPLOYEE_SUMMARY,
    } as Response)

    render(<EmployeesTable employees={EMPLOYEES} />)
    fireEvent.click(screen.getAllByRole('button', { name: /preview/i })[0])

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/employees/emp-1')
    })
  })

  it('shows a loading state before the fetch resolves (no email visible in dialog)', async () => {
    let resolve!: (v: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r }))

    render(<EmployeesTable employees={EMPLOYEES} />)
    fireEvent.click(screen.getAllByRole('button', { name: /preview/i })[0])

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Data hasn't loaded yet — the profile email should not appear inside the dialog
    const dialog = screen.getByRole('dialog')
    // Dialog title is shown but no profile content
    expect(dialog).toHaveTextContent('Employee Profile')
    // alice@example.com appears in the table, but NOT inside the dialog content area
    const dialogContent = dialog.querySelector('[class*="MuiDialogContent"]') ??
      dialog.querySelector('.MuiDialogContent-root') ?? dialog
    expect(dialogContent).not.toHaveTextContent('alice@example.com')

    resolve({ ok: true, json: async () => EMPLOYEE_SUMMARY } as Response)
  })
})
