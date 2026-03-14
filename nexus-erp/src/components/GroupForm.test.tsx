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
  default: () => <div data-testid="permission-matrix" />,
}))

// ── Component import ──────────────────────────────────────────────────────────

import GroupForm from './GroupForm'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_USERS = [
  { userId: 'user-1', fullName: 'Alice', email: 'alice@example.com' },
  { userId: 'user-2', fullName: 'Bob', email: 'bob@example.com' },
]

const ALL_PERMISSIONS = [
  { key: 'employees:read', label: 'Read Employees', type: 'crud' },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GroupForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Create mode ───────────────────────────────────────────────────────────────

  it('renders "New Group" heading in create mode', () => {
    render(<GroupForm mode="create" allPermissions={ALL_PERMISSIONS} allUsers={ALL_USERS} />)
    expect(screen.getByText('New Group')).toBeInTheDocument()
  })

  it('renders Group Name, Description fields and Create Group button', () => {
    render(<GroupForm mode="create" allPermissions={ALL_PERMISSIONS} allUsers={ALL_USERS} />)
    expect(screen.getByLabelText(/group name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create group/i })).toBeInTheDocument()
  })

  it('Create button is disabled when name is empty', () => {
    render(<GroupForm mode="create" allPermissions={ALL_PERMISSIONS} allUsers={ALL_USERS} />)
    expect(screen.getByRole('button', { name: /create group/i })).toBeDisabled()
  })

  it('POSTs to /api/groups and redirects on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'grp-new' }),
    } as Response)

    render(<GroupForm mode="create" allPermissions={ALL_PERMISSIONS} allUsers={ALL_USERS} />)
    fireEvent.change(screen.getByLabelText(/group name/i), { target: { value: 'Dev Group' } })
    fireEvent.click(screen.getByRole('button', { name: /create group/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/groups',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(mockPush).toHaveBeenCalledWith('/groups/grp-new')
    })
  })

  it('shows snackbar error when create fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Name already taken' }),
    } as Response)

    render(<GroupForm mode="create" allPermissions={ALL_PERMISSIONS} allUsers={ALL_USERS} />)
    fireEvent.change(screen.getByLabelText(/group name/i), { target: { value: 'Dev Group' } })
    fireEvent.click(screen.getByRole('button', { name: /create group/i }))

    await waitFor(() => {
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', message: 'Name already taken' }),
      )
    })
  })

  // ── Group type toggle ─────────────────────────────────────────────────────────

  it('defaults to Security type and shows Members section', () => {
    render(<GroupForm mode="create" allPermissions={ALL_PERMISSIONS} allUsers={ALL_USERS} />)
    // "Members" appears as both the section overline and the autocomplete label
    expect(screen.getAllByText('Members').length).toBeGreaterThan(0)
  })

  it('hides Members section when Default type is selected', async () => {
    render(<GroupForm mode="create" allPermissions={ALL_PERMISSIONS} allUsers={ALL_USERS} />)
    // Click the Default toggle option by its visible text
    const defaultToggle = screen.getByText('Default', { selector: 'button, [role="button"]' })
    fireEvent.click(defaultToggle)

    await waitFor(() => {
      // After switching to Default, the Members overline section heading disappears
      const members = screen.queryAllByText('Members', { selector: 'span' })
      const overlineMembers = members.filter((el) =>
        el.className.includes('overline'),
      )
      expect(overlineMembers.length).toBe(0)
    })
  })

  it('shows "All users inherit this group\'s permissions" hint for Default type', async () => {
    render(<GroupForm mode="create" allPermissions={ALL_PERMISSIONS} allUsers={ALL_USERS} />)
    const defaultToggle = screen.getByText('Default', { selector: 'button, [role="button"]' })
    fireEvent.click(defaultToggle)

    await waitFor(() => {
      expect(screen.getByText(/all users inherit/i)).toBeInTheDocument()
    })
  })

  // ── Edit mode ─────────────────────────────────────────────────────────────────

  it('renders the group name as heading in edit mode', () => {
    render(
      <GroupForm
        mode="edit"
        groupId="grp-1"
        defaultName="Admins"
        allPermissions={ALL_PERMISSIONS}
        allUsers={ALL_USERS}
      />,
    )
    expect(screen.getByText('Admins')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('PATCHes group and permissions and shows success snackbar in edit mode', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true } as Response)  // PATCH /groups/grp-1
      .mockResolvedValueOnce({ ok: true } as Response)  // PUT /groups/grp-1/permissions
      .mockResolvedValueOnce({ ok: true } as Response)  // PUT /groups/grp-1/members

    render(
      <GroupForm
        mode="edit"
        groupId="grp-1"
        defaultName="Admins"
        allPermissions={ALL_PERMISSIONS}
        allUsers={ALL_USERS}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/groups/grp-1',
        expect.objectContaining({ method: 'PATCH' }),
      )
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
    })
  })

  it('shows "Default Group" chip in edit mode when type is default', () => {
    render(
      <GroupForm
        mode="edit"
        groupId="grp-2"
        defaultName="Everyone"
        defaultType="default"
        allPermissions={ALL_PERMISSIONS}
        allUsers={ALL_USERS}
      />,
    )
    expect(screen.getByText('Default Group')).toBeInTheDocument()
  })
})
