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

// ── Component import ──────────────────────────────────────────────────────────

import OrganizationForm from './OrganizationForm'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_EMPLOYEES = [
  { id: 'emp-1', fullName: 'Alice' },
  { id: 'emp-2', fullName: 'Bob' },
]

const BASE_DEFAULTS = {
  name: 'Acme Corp',
  legalName: 'Acme Corporation',
  industry: 'Tech',
  taxId: 'TAX-123',
  registrationNo: 'REG-456',
  status: 'active' as const,
  email: 'contact@acme.com',
  phone: null,
  website: null,
  street: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  ownerId: null,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OrganizationForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Create mode ───────────────────────────────────────────────────────────────

  it('renders "New Organization" heading in create mode', () => {
    render(<OrganizationForm mode="create" allEmployees={ALL_EMPLOYEES} isManager={true} isOwner={false} />)
    expect(screen.getByText('New Organization')).toBeInTheDocument()
  })

  it('renders Organization Name field', () => {
    render(<OrganizationForm mode="create" allEmployees={ALL_EMPLOYEES} isManager={true} isOwner={false} />)
    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument()
  })

  it('renders Create Organization button when manager in create mode', () => {
    render(<OrganizationForm mode="create" allEmployees={ALL_EMPLOYEES} isManager={true} isOwner={false} />)
    expect(screen.getByRole('button', { name: /create organization/i })).toBeInTheDocument()
  })

  it('POSTs and redirects on successful create', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'org-new' }),
    } as Response)

    render(<OrganizationForm mode="create" allEmployees={ALL_EMPLOYEES} isManager={true} isOwner={false} />)
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'New Co' } })
    fireEvent.click(screen.getByRole('button', { name: /create organization/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/organizations', expect.objectContaining({ method: 'POST' }))
      expect(mockPush).toHaveBeenCalledWith('/organizations/org-new')
    })
  })

  // ── Edit mode — read-only (non-manager, non-owner) ────────────────────────────

  it('does not render Save Changes or Create buttons in read-only mode', () => {
    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={BASE_DEFAULTS}
        allEmployees={ALL_EMPLOYEES}
        isManager={false}
        isOwner={false}
      />,
    )
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create organization/i })).not.toBeInTheDocument()
  })

  it('disables Identity fields when not manager', () => {
    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={BASE_DEFAULTS}
        allEmployees={ALL_EMPLOYEES}
        isManager={false}
        isOwner={false}
      />,
    )
    expect(screen.getByLabelText(/organization name/i)).toBeDisabled()
  })

  // ── Edit mode — manager ───────────────────────────────────────────────────────

  it('renders Save Changes button for manager in edit mode', () => {
    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={BASE_DEFAULTS}
        allEmployees={ALL_EMPLOYEES}
        isManager={true}
        isOwner={false}
      />,
    )
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('renders status action buttons for active org (manager, edit mode)', () => {
    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={{ ...BASE_DEFAULTS, status: 'active' }}
        allEmployees={ALL_EMPLOYEES}
        isManager={true}
        isOwner={false}
      />,
    )
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /archive/i })).toBeInTheDocument()
  })

  it('renders Reactivate button for inactive org (manager, edit mode)', () => {
    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={{ ...BASE_DEFAULTS, status: 'inactive' }}
        allEmployees={ALL_EMPLOYEES}
        isManager={true}
        isOwner={false}
      />,
    )
    expect(screen.getByRole('button', { name: /reactivate/i })).toBeInTheDocument()
  })

  it('shows Approve/Deny buttons when manager has a pending workflow', () => {
    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={BASE_DEFAULTS}
        allEmployees={ALL_EMPLOYEES}
        isManager={true}
        isOwner={false}
        workflowInstanceId="wf-123"
      />,
    )
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument()
  })

  // ── Edit mode — owner (not manager) ──────────────────────────────────────────

  it('shows Request Status Change button for owner (not manager) without pending workflow', () => {
    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={BASE_DEFAULTS}
        allEmployees={ALL_EMPLOYEES}
        isManager={false}
        isOwner={true}
      />,
    )
    expect(screen.getByRole('button', { name: /request status change/i })).toBeInTheDocument()
  })

  it('shows pending alert with Cancel button for owner when workflow is pending', () => {
    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={BASE_DEFAULTS}
        allEmployees={ALL_EMPLOYEES}
        isManager={false}
        isOwner={true}
        workflowInstanceId="wf-456"
      />,
    )
    expect(screen.getByText(/pending manager approval/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  // ── Request Status Change dialog ──────────────────────────────────────────────

  it('opens the Request Status Change dialog when button is clicked', async () => {
    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={BASE_DEFAULTS}
        allEmployees={ALL_EMPLOYEES}
        isManager={false}
        isOwner={true}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /request status change/i }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      // Both the button and the dialog title contain "Request Status Change"
      expect(screen.getAllByText('Request Status Change').length).toBeGreaterThan(1)
    })
  })

  it('Submit Request button is disabled when reason is empty', async () => {
    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={BASE_DEFAULTS}
        allEmployees={ALL_EMPLOYEES}
        isManager={false}
        isOwner={true}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /request status change/i }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /submit request/i })).toBeDisabled()
  })

  // ── Deactivate action ─────────────────────────────────────────────────────────

  it('POSTs to /deactivate and shows snackbar', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)

    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={{ ...BASE_DEFAULTS, status: 'active' }}
        allEmployees={ALL_EMPLOYEES}
        isManager={true}
        isOwner={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /deactivate/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/organizations/org-1/deactivate', { method: 'POST' })
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
    })
  })

  // ── Save action ───────────────────────────────────────────────────────────────

  it('calls PATCH for identity and contact in parallel on save (manager + owner)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)

    render(
      <OrganizationForm
        mode="edit"
        orgId="org-1"
        defaultValues={BASE_DEFAULTS}
        allEmployees={ALL_EMPLOYEES}
        isManager={true}
        isOwner={true}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls
      expect(calls.some(([url]) => String(url).includes('/api/organizations/org-1'))).toBe(true)
      expect(mockShowSnackbar).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }))
    })
  })
})
