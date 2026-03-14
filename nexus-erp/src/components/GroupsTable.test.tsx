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

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/components/SnackbarContext', () => ({
  useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}))

// ── Component import (after mocks) ────────────────────────────────────────────

import GroupsTable from './GroupsTable'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GROUPS = [
  {
    id: 'grp-1',
    name: 'Admins',
    description: 'Admin group',
    type: 'security' as const,
    _count: { permissions: 4, members: 2 },
  },
  {
    id: 'grp-2',
    name: 'All Users',
    description: null,
    type: 'default' as const,
    _count: { permissions: 1, members: 0 },
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GroupsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('confirm', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Rendering ─────────────────────────────────────────────────────────────────

  it('renders an empty state message when there are no groups', () => {
    render(<GroupsTable groups={[]} />)
    expect(screen.getByText(/no groups yet/i)).toBeInTheDocument()
  })

  it('renders group names and descriptions', () => {
    render(<GroupsTable groups={GROUPS} />)
    expect(screen.getByText('Admins')).toBeInTheDocument()
    expect(screen.getByText('All Users')).toBeInTheDocument()
    expect(screen.getByText('Admin group')).toBeInTheDocument()
  })

  it('shows "All users" for default-type groups in the members column', () => {
    render(<GroupsTable groups={GROUPS} />)
    expect(screen.getByText('All users')).toBeInTheDocument()
  })

  it('shows a "Default" chip for groups with type=default', () => {
    render(<GroupsTable groups={GROUPS} />)
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('renders a New Group button linking to /groups/new', () => {
    render(<GroupsTable groups={GROUPS} />)
    const addBtn = screen.getByRole('link', { name: /new group/i })
    expect(addBtn).toHaveAttribute('href', '/groups/new')
  })

  // ── Delete with window.confirm ────────────────────────────────────────────────

  it('does not call fetch when confirm is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false)

    render(<GroupsTable groups={GROUPS} />)

    // Find delete buttons (icon buttons not wrapped in <a>)
    const nonLinkButtons = screen.getAllByRole('button').filter((b) => !b.closest('a'))
    fireEvent.click(nonLinkButtons[0])

    expect(window.confirm).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('DELETEs the group and shows a success snackbar when confirmed', async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(true)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)

    render(<GroupsTable groups={GROUPS} />)

    const nonLinkButtons = screen.getAllByRole('button').filter((b) => !b.closest('a'))
    fireEvent.click(nonLinkButtons[0]) // delete Admins

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/groups/grp-1', { method: 'DELETE' })
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
      expect(mockRefresh).toHaveBeenCalledOnce()
    })
  })

  it('shows an error snackbar when delete fails', async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(true)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Group in use' }),
    } as Response)

    render(<GroupsTable groups={GROUPS} />)

    const nonLinkButtons = screen.getAllByRole('button').filter((b) => !b.closest('a'))
    fireEvent.click(nonLinkButtons[0])

    await waitFor(() => {
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', message: 'Group in use' }),
      )
    })
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
