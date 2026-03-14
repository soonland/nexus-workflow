// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
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

import DepartmentsTable from './DepartmentsTable'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  { id: 'dept-1', name: 'Engineering', createdAt: '2024-01-15T00:00:00Z', _count: { employees: 5 } },
  { id: 'dept-2', name: 'Marketing', createdAt: '2024-03-20T00:00:00Z', _count: { employees: 2 } },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DepartmentsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Rendering ─────────────────────────────────────────────────────────────────

  it('renders an empty state message when there are no departments', () => {
    render(<DepartmentsTable departments={[]} />)
    expect(screen.getByText(/no departments yet/i)).toBeInTheDocument()
  })

  it('renders department names and employee counts', () => {
    render(<DepartmentsTable departments={DEPARTMENTS} />)
    expect(screen.getByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText('Marketing')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders an Add Department button linking to /departments/new', () => {
    render(<DepartmentsTable departments={DEPARTMENTS} />)
    const addBtn = screen.getByRole('link', { name: /add department/i })
    expect(addBtn).toHaveAttribute('href', '/departments/new')
  })

  // ── Delete dialog ─────────────────────────────────────────────────────────────

  it('opens the delete confirmation dialog when the delete icon is clicked', async () => {
    render(<DepartmentsTable departments={DEPARTMENTS} />)
    // Find the delete icon button for Engineering (second icon button per row: edit + delete)
    const allIconButtons = screen.getAllByRole('button')
    // Delete buttons have color="error" — we look for them by finding the second button per row
    // More robustly, open delete for the first row by clicking the delete icon
    const deleteBtn = allIconButtons.find((btn) => btn.getAttribute('color') === 'error') ??
      allIconButtons[1] // fallback

    fireEvent.click(deleteBtn)
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(/delete department/i)).toBeInTheDocument()
    })
  })

  it('shows the department name in the delete confirmation dialog', async () => {
    render(<DepartmentsTable departments={DEPARTMENTS} />)

    const nonLinkButtons = screen.getAllByRole('button').filter((b) => !b.closest('a'))
    fireEvent.click(nonLinkButtons[0])

    await waitFor(() => {
      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
      // The department name appears inside the dialog text
      expect(within(dialog).getByText('Engineering')).toBeInTheDocument()
    })
  })

  it('closes the dialog when Cancel is clicked', async () => {
    render(<DepartmentsTable departments={DEPARTMENTS} />)

    const nonLinkButtons = screen.getAllByRole('button').filter((b) => !b.closest('a'))
    fireEvent.click(nonLinkButtons[0])
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeInTheDocument() })

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  // ── Delete action ─────────────────────────────────────────────────────────────

  it('DELETEs the department and refreshes on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)

    render(<DepartmentsTable departments={DEPARTMENTS} />)

    const nonLinkButtons = screen.getAllByRole('button').filter((b) => !b.closest('a'))
    fireEvent.click(nonLinkButtons[0]) // open dialog for first dept
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeInTheDocument() })

    const confirmDelete = screen.getByRole('button', { name: /^delete$/i })
    fireEvent.click(confirmDelete)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/departments/dept-1', { method: 'DELETE' })
      expect(mockRefresh).toHaveBeenCalledOnce()
    })
  })

  it('shows a snackbar error when delete fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Cannot delete department' }),
    } as Response)

    render(<DepartmentsTable departments={DEPARTMENTS} />)

    const nonLinkButtons = screen.getAllByRole('button').filter((b) => !b.closest('a'))
    fireEvent.click(nonLinkButtons[0])
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeInTheDocument() })

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', message: 'Cannot delete department' }),
      )
    })
  })
})
