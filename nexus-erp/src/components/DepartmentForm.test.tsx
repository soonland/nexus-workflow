// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockPush = vi.fn()
const mockRefresh = vi.fn()
const mockShowSnackbar = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/components/SnackbarContext', () => ({
  useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}))

vi.mock('@/components/PermissionMatrix', () => ({
  default: ({ onToggle }: { onToggle: (key: string, checked: boolean) => void }) => (
    <div data-testid="permission-matrix">
      <button onClick={() => onToggle('employees:read', true)}>Toggle Permission</button>
    </div>
  ),
}))

// ── Component import ──────────────────────────────────────────────────────────

import DepartmentForm from './DepartmentForm'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_EMPLOYEES = [
  { id: 'emp-1', fullName: 'Alice', departmentId: null, departmentName: null },
  { id: 'emp-2', fullName: 'Bob', departmentId: 'dept-99', departmentName: 'Marketing' },
]

const ALL_PERMISSIONS = [
  { key: 'employees:read', label: 'Read Employees', type: 'crud' },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DepartmentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Create mode ───────────────────────────────────────────────────────────────

  it('renders "New Department" heading in create mode', () => {
    render(<DepartmentForm mode="create" allEmployees={ALL_EMPLOYEES} />)
    expect(screen.getByText('New Department')).toBeInTheDocument()
  })

  it('renders Department Name field and Create Department button', () => {
    render(<DepartmentForm mode="create" allEmployees={ALL_EMPLOYEES} />)
    expect(screen.getByLabelText(/department name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create department/i })).toBeInTheDocument()
  })

  it('disables Create button when name is empty', () => {
    render(<DepartmentForm mode="create" allEmployees={ALL_EMPLOYEES} />)
    expect(screen.getByRole('button', { name: /create department/i })).toBeDisabled()
  })

  it('enables Create button when name has content', () => {
    render(<DepartmentForm mode="create" allEmployees={ALL_EMPLOYEES} />)
    fireEvent.change(screen.getByLabelText(/department name/i), { target: { value: 'Dev Team' } })
    expect(screen.getByRole('button', { name: /create department/i })).not.toBeDisabled()
  })

  it('POSTs to /api/departments and redirects on success in create mode', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'dept-new' }),
    } as Response)

    render(<DepartmentForm mode="create" allEmployees={ALL_EMPLOYEES} />)
    fireEvent.change(screen.getByLabelText(/department name/i), { target: { value: 'Dev Team' } })
    fireEvent.click(screen.getByRole('button', { name: /create department/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/departments',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(mockPush).toHaveBeenCalledWith('/departments/dept-new')
    })
  })

  it('shows snackbar error on create failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal error' }),
    } as Response)

    render(<DepartmentForm mode="create" allEmployees={ALL_EMPLOYEES} />)
    fireEvent.change(screen.getByLabelText(/department name/i), { target: { value: 'Dev Team' } })
    fireEvent.click(screen.getByRole('button', { name: /create department/i }))

    await waitFor(() => {
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', message: 'Internal error' }),
      )
    })
  })

  // ── Edit mode ─────────────────────────────────────────────────────────────────

  it('renders the department name as heading in edit mode', () => {
    render(
      <DepartmentForm
        mode="edit"
        departmentId="dept-1"
        defaultName="Engineering"
        allEmployees={ALL_EMPLOYEES}
        allPermissions={ALL_PERMISSIONS}
      />,
    )
    expect(screen.getByText('Engineering')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('shows the PermissionMatrix in edit mode', () => {
    render(
      <DepartmentForm
        mode="edit"
        departmentId="dept-1"
        defaultName="Engineering"
        allEmployees={ALL_EMPLOYEES}
        allPermissions={ALL_PERMISSIONS}
      />,
    )
    expect(screen.getByTestId('permission-matrix')).toBeInTheDocument()
  })

  it('does not show the PermissionMatrix in create mode', () => {
    render(<DepartmentForm mode="create" allEmployees={ALL_EMPLOYEES} allPermissions={ALL_PERMISSIONS} />)
    expect(screen.queryByTestId('permission-matrix')).not.toBeInTheDocument()
  })

  it('PATCHes to /api/departments/[id] and shows snackbar on save in edit mode', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)

    render(
      <DepartmentForm
        mode="edit"
        departmentId="dept-1"
        defaultName="Engineering"
        allEmployees={ALL_EMPLOYEES}
        allPermissions={ALL_PERMISSIONS}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/departments/dept-1',
        expect.objectContaining({ method: 'PATCH' }),
      )
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
    })
  })

  it('saves permissions when Save Permissions is clicked', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)

    render(
      <DepartmentForm
        mode="edit"
        departmentId="dept-1"
        defaultName="Engineering"
        allEmployees={ALL_EMPLOYEES}
        allPermissions={ALL_PERMISSIONS}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /save permissions/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/departments/dept-1/permissions',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  it('shows snackbar error when saving permissions fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Permission save failed' }),
    } as Response)

    render(
      <DepartmentForm
        mode="edit"
        departmentId="dept-1"
        defaultName="Engineering"
        allEmployees={ALL_EMPLOYEES}
        allPermissions={ALL_PERMISSIONS}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /save permissions/i }))

    await waitFor(() => {
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', message: 'Permission save failed' }),
      )
    })
  })

  it('renders existing members as chips in edit mode', () => {
    render(
      <DepartmentForm
        mode="edit"
        departmentId="dept-1"
        defaultName="Engineering"
        allEmployees={ALL_EMPLOYEES}
        allPermissions={ALL_PERMISSIONS}
        defaultMembers={[{ id: 'emp-1', fullName: 'Alice', departmentId: null, departmentName: null }]}
      />,
    )
    // The Autocomplete renderTags callback is invoked — Alice chip is visible
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows snackbar error when saving changes fails in edit mode', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Save failed' }),
    } as Response)

    render(
      <DepartmentForm
        mode="edit"
        departmentId="dept-1"
        defaultName="Engineering"
        allEmployees={ALL_EMPLOYEES}
        allPermissions={ALL_PERMISSIONS}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', message: 'Save failed' }),
      )
    })
  })
})
