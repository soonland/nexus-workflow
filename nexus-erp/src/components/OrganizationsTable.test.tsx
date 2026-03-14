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

// ── Component import ──────────────────────────────────────────────────────────

import OrganizationsTable from './OrganizationsTable'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORGS = [
  { id: 'org-1', name: 'Acme Corp', legalName: 'Acme Corporation', industry: 'Tech', status: 'active' as const, owner: { id: 'emp-1', fullName: 'Alice' } },
  { id: 'org-2', name: 'Beta Ltd', legalName: null, industry: null, status: 'inactive' as const, owner: null },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OrganizationsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Rendering ─────────────────────────────────────────────────────────────────

  it('renders empty state when no organizations', () => {
    render(<OrganizationsTable organizations={[]} isManager={false} />)
    expect(screen.getByText(/no organizations yet/i)).toBeInTheDocument()
  })

  it('renders organization names and statuses', () => {
    render(<OrganizationsTable organizations={ORGS} isManager={false} />)
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('Beta Ltd')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('renders legalName and falls back to — when null', () => {
    render(<OrganizationsTable organizations={ORGS} isManager={false} />)
    expect(screen.getByText('Acme Corporation')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('renders owner name and falls back to — when null', () => {
    render(<OrganizationsTable organizations={ORGS} isManager={false} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  // ── Manager-only UI ───────────────────────────────────────────────────────────

  it('shows Add Organization button for managers', () => {
    render(<OrganizationsTable organizations={ORGS} isManager={true} />)
    expect(screen.getByRole('link', { name: /add organization/i })).toHaveAttribute('href', '/organizations/new')
  })

  it('hides Add Organization button for non-managers', () => {
    render(<OrganizationsTable organizations={ORGS} isManager={false} />)
    expect(screen.queryByRole('link', { name: /add organization/i })).not.toBeInTheDocument()
  })

  it('shows archive icon buttons for managers', () => {
    render(<OrganizationsTable organizations={ORGS} isManager={true} />)
    // Archive buttons are icon buttons not wrapped in <a>
    const nonLinkButtons = screen.getAllByRole('button').filter((b) => !b.closest('a'))
    expect(nonLinkButtons.length).toBeGreaterThan(0)
  })

  it('hides archive icon buttons for non-managers', () => {
    render(<OrganizationsTable organizations={ORGS} isManager={false} />)
    const nonLinkButtons = screen.queryAllByRole('button').filter((b) => !b.closest('a'))
    expect(nonLinkButtons.length).toBe(0)
  })

  // ── Archive action ────────────────────────────────────────────────────────────

  it('POSTs to archive endpoint and shows snackbar on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)
    render(<OrganizationsTable organizations={ORGS} isManager={true} />)

    const archiveButtons = screen.getAllByRole('button').filter((b) => !b.closest('a'))
    fireEvent.click(archiveButtons[0])

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/organizations/org-1/archive', { method: 'POST' })
      expect(mockShowSnackbar).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }))
      expect(mockRefresh).toHaveBeenCalledOnce()
    })
  })

  it('shows error snackbar when archive fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Cannot archive' }),
    } as Response)
    render(<OrganizationsTable organizations={ORGS} isManager={true} />)

    const archiveButtons = screen.getAllByRole('button').filter((b) => !b.closest('a'))
    fireEvent.click(archiveButtons[0])

    await waitFor(() => {
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', message: 'Cannot archive' }),
      )
    })
  })
})
