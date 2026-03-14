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

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/SnackbarContext', () => ({
  useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}))

vi.mock('@/components/PermissionMatrix', () => ({
  default: () => <div data-testid="permission-matrix" />,
}))

// ── Component import ──────────────────────────────────────────────────────────

import EmployeeEditForm from './EmployeeEditForm'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_VALUES = {
  fullName: 'Alice Smith',
  departmentId: null,
  hireDate: '2023-03-15',
  managerId: null,
  role: 'employee' as const,
  phone: null,
  street: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
}

const MANAGERS = [{ id: 'mgr-1', fullName: 'Bob Manager' }]
const DEPARTMENTS = [{ id: 'dept-1', name: 'Engineering' }]
const ALL_PERMISSIONS = [{ key: 'employees:read', label: 'Read Employees', type: 'crud' }]
const ALL_GROUPS = [{ groupId: 'grp-1', groupName: 'Admins' }]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EmployeeEditForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Rendering ─────────────────────────────────────────────────────────────────

  it('renders the employment section with full name pre-filled', () => {
    render(
      <EmployeeEditForm
        employeeId="emp-1"
        userId="user-1"
        defaultValues={DEFAULT_VALUES}
        managers={MANAGERS}
        departments={DEPARTMENTS}
        allPermissions={ALL_PERMISSIONS}
        userPermissions={[]}
        allGroups={ALL_GROUPS}
        userGroups={[]}
      />,
    )
    expect(screen.getByDisplayValue('Alice Smith')).toBeInTheDocument()
  })

  it('renders hire date field', () => {
    render(
      <EmployeeEditForm
        employeeId="emp-1"
        userId="user-1"
        defaultValues={DEFAULT_VALUES}
        managers={MANAGERS}
        departments={DEPARTMENTS}
        allPermissions={ALL_PERMISSIONS}
        userPermissions={[]}
        allGroups={ALL_GROUPS}
        userGroups={[]}
      />,
    )
    expect(screen.getByDisplayValue('2023-03-15')).toBeInTheDocument()
  })

  it('renders the PermissionMatrix component', () => {
    render(
      <EmployeeEditForm
        employeeId="emp-1"
        userId="user-1"
        defaultValues={DEFAULT_VALUES}
        managers={MANAGERS}
        departments={DEPARTMENTS}
        allPermissions={ALL_PERMISSIONS}
        userPermissions={[]}
        allGroups={ALL_GROUPS}
        userGroups={[]}
      />,
    )
    expect(screen.getByTestId('permission-matrix')).toBeInTheDocument()
  })

  it('renders the save profile and save permissions buttons (translated keys)', () => {
    render(
      <EmployeeEditForm
        employeeId="emp-1"
        userId="user-1"
        defaultValues={DEFAULT_VALUES}
        managers={MANAGERS}
        departments={DEPARTMENTS}
        allPermissions={ALL_PERMISSIONS}
        userPermissions={[]}
        allGroups={ALL_GROUPS}
        userGroups={[]}
      />,
    )
    // useTranslations returns the key as-is, so labels are their translation keys
    expect(screen.getByRole('button', { name: 'save.profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'save.permissions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'save.groups' })).toBeInTheDocument()
  })

  // ── Save profile ──────────────────────────────────────────────────────────────

  it('PATCHes to /api/employees/[id] and shows snackbar on save', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)

    render(
      <EmployeeEditForm
        employeeId="emp-42"
        userId="user-42"
        defaultValues={DEFAULT_VALUES}
        managers={MANAGERS}
        departments={DEPARTMENTS}
        allPermissions={ALL_PERMISSIONS}
        userPermissions={[]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'save.profile' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/employees/emp-42',
        expect.objectContaining({ method: 'PATCH' }),
      )
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
    })
  })

  it('shows error snackbar when save profile fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    } as Response)

    render(
      <EmployeeEditForm
        employeeId="emp-42"
        userId="user-42"
        defaultValues={DEFAULT_VALUES}
        managers={MANAGERS}
        departments={DEPARTMENTS}
        allPermissions={ALL_PERMISSIONS}
        userPermissions={[]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'save.profile' }))

    await waitFor(() => {
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', message: 'Server error' }),
      )
    })
  })

  // ── Save permissions ──────────────────────────────────────────────────────────

  it('PUTs to /api/users/[id]/permissions when Save Permissions is clicked', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)

    render(
      <EmployeeEditForm
        employeeId="emp-1"
        userId="user-99"
        defaultValues={DEFAULT_VALUES}
        managers={MANAGERS}
        departments={DEPARTMENTS}
        allPermissions={ALL_PERMISSIONS}
        userPermissions={[]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'save.permissions' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/users/user-99/permissions',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  // ── Save groups ───────────────────────────────────────────────────────────────

  it('PUTs to /api/users/[id]/groups when Save Groups is clicked', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)

    render(
      <EmployeeEditForm
        employeeId="emp-1"
        userId="user-99"
        defaultValues={DEFAULT_VALUES}
        managers={MANAGERS}
        departments={DEPARTMENTS}
        allPermissions={ALL_PERMISSIONS}
        userPermissions={[]}
        allGroups={ALL_GROUPS}
        userGroups={[]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'save.groups' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/users/user-99/groups',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  // ── No permissions defined ─────────────────────────────────────────────────────

  it('shows "noPermissions" text when allPermissions is empty', () => {
    render(
      <EmployeeEditForm
        employeeId="emp-1"
        userId="user-1"
        defaultValues={DEFAULT_VALUES}
        managers={MANAGERS}
        departments={DEPARTMENTS}
        allPermissions={[]}
        userPermissions={[]}
      />,
    )
    expect(screen.getByText('noPermissions')).toBeInTheDocument()
    expect(screen.queryByTestId('permission-matrix')).not.toBeInTheDocument()
  })
})
