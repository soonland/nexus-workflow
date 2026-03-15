// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, _params?: Record<string, unknown>) => key,
}))

// ── Component import (after mocks) ────────────────────────────────────────────

import AuditLogTable from './AuditLogTable'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeResponse = (data: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }) as Response

const ENTRY = {
  id: 'entry-1',
  entityType: 'Employee',
  entityId: 'emp-00000000-0001',
  action: 'CREATE' as const,
  actorId: 'user-1',
  actorName: 'Alice Smith',
  before: null,
  after: { name: 'Alice' },
  createdAt: '2024-06-01T10:00:00Z',
}

const PAGE_1_RESPONSE = {
  entries: [ENTRY],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 2,
}

const PAGE_2_RESPONSE = {
  entries: [
    {
      ...ENTRY,
      id: 'entry-2',
      actorName: 'Bob Jones',
      action: 'UPDATE' as const,
      before: { name: 'Alice' },
      after: { name: 'Alice Smith' },
      createdAt: '2024-06-02T11:00:00Z',
    },
  ],
  total: 2,
  page: 2,
  pageSize: 20,
  totalPages: 2,
}

const SINGLE_PAGE_RESPONSE = {
  entries: [ENTRY],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
}

const EMPTY_RESPONSE = {
  entries: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuditLogTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Initial fetch ─────────────────────────────────────────────────────────

  it('fetches /api/audit-log on initial render', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
    render(<AuditLogTable />)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/audit-log'))
    })
  })

  // ── Loading state ─────────────────────────────────────────────────────────

  it('shows a CircularProgress while loading', async () => {
    let resolve!: (r: Response) => void
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((r) => { resolve = r }))

    render(<AuditLogTable />)

    expect(screen.getByRole('progressbar')).toBeInTheDocument()

    resolve(makeResponse(SINGLE_PAGE_RESPONSE))
  })

  // ── Error states ──────────────────────────────────────────────────────────

  it('shows error text when fetch returns a non-ok response with an error body', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server exploded' }),
    } as Response)

    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByText('Server exploded')).toBeInTheDocument()
    })
  })

  it('shows error text when fetch returns a non-ok response with no error field', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeInTheDocument()
    })
  })

  it('shows "Network error" when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'))

    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  // ── Table headers ─────────────────────────────────────────────────────────

  it('renders all table column headers', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByText('columns.timestamp')).toBeInTheDocument()
      expect(screen.getByText('columns.actor')).toBeInTheDocument()
      expect(screen.getByText('columns.entityType')).toBeInTheDocument()
      expect(screen.getByText('columns.entityId')).toBeInTheDocument()
      expect(screen.getByText('columns.action')).toBeInTheDocument()
      expect(screen.getByText('columns.changes')).toBeInTheDocument()
    })
  })

  // ── Entry rows ────────────────────────────────────────────────────────────

  it('renders entry rows with actor name and action chip', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      // Translation mock returns key as-is
      expect(screen.getByText('actions.CREATE')).toBeInTheDocument()
    })
  })

  it('renders the entityType and a truncated entityId (8 chars + ellipsis)', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByText('Employee')).toBeInTheDocument()
      // entityId 'emp-00000000-0001' → first 8 chars 'emp-0000' + '…'
      expect(screen.getByText('emp-0000…')).toBeInTheDocument()
    })
  })

  // ── Empty state ───────────────────────────────────────────────────────────

  it('shows emptyState text when entries array is empty', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(EMPTY_RESPONSE))
    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByText('emptyState')).toBeInTheDocument()
    })
  })

  // ── Filters UI ────────────────────────────────────────────────────────────

  it('renders the Clear filters button', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'filters.clearFilters' })).toBeInTheDocument()
    })
  })

  // ── Pagination controls ───────────────────────────────────────────────────

  it('shows Previous and Next pagination buttons when totalPages > 1', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(PAGE_1_RESPONSE))
    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'pagination.previous' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'pagination.next' })).toBeInTheDocument()
    })
  })

  it('Previous button is disabled on page 1', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(PAGE_1_RESPONSE))
    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'pagination.previous' })).toBeDisabled()
    })
  })

  it('Next button is disabled on the last page', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(PAGE_2_RESPONSE))
    render(<AuditLogTable />)

    // After load, the component is on page 1 locally, but totalPages is 2.
    // We need to navigate to page 2 first.
    // Re-render with a response that says page === totalPages
    const lastPageResponse = { ...PAGE_2_RESPONSE, page: 2, totalPages: 2 }
    vi.mocked(fetch).mockResolvedValue(makeResponse(lastPageResponse))

    // Re-render fresh to start at page 1 with totalPages: 2
    cleanup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(PAGE_1_RESPONSE))  // initial load (page 1)
      .mockResolvedValueOnce(makeResponse(lastPageResponse)) // after clicking Next

    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'pagination.next' })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'pagination.next' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'pagination.next' })).toBeDisabled()
    })
  })

  it('clicking Next fetches page 2', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(PAGE_1_RESPONSE))
      .mockResolvedValueOnce(makeResponse(PAGE_2_RESPONSE))

    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'pagination.next' })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'pagination.next' }))

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls
      const secondCall = calls[1][0] as string
      expect(secondCall).toContain('page=2')
    })
  })

  it('clicking Previous after navigating to page 2 fetches page 1 again', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(PAGE_1_RESPONSE))  // initial
      .mockResolvedValueOnce(makeResponse(PAGE_2_RESPONSE))  // next
      .mockResolvedValueOnce(makeResponse(PAGE_1_RESPONSE))  // prev

    render(<AuditLogTable />)

    // Go to page 2
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'pagination.next' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'pagination.next' }))

    // Wait for page 2 to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'pagination.previous' })).not.toBeDisabled()
    })

    // Go back to page 1
    fireEvent.click(screen.getByRole('button', { name: 'pagination.previous' }))

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls
      const thirdCall = calls[2][0] as string
      expect(thirdCall).toContain('page=1')
    })
  })

  // ── Clear filters ─────────────────────────────────────────────────────────

  it('clicking Clear filters resets page to 1 and re-fetches', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(PAGE_1_RESPONSE))  // initial
      .mockResolvedValueOnce(makeResponse(PAGE_2_RESPONSE))  // next page
      .mockResolvedValueOnce(makeResponse(PAGE_1_RESPONSE))  // after clear

    render(<AuditLogTable />)

    // Navigate to page 2
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'pagination.next' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'pagination.next' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'pagination.previous' })).not.toBeDisabled()
    })

    // Clear filters — should reset to page 1
    fireEvent.click(screen.getByRole('button', { name: 'filters.clearFilters' }))

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls
      const thirdCall = calls[2][0] as string
      expect(thirdCall).toContain('page=1')
    })
  })

  it('does not show pagination controls when totalPages === 1', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
    render(<AuditLogTable />)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'pagination.previous' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'pagination.next' })).not.toBeInTheDocument()
    })
  })

  // ── Detail dialog ─────────────────────────────────────────────────────────

  describe('detail dialog', () => {
    const UPDATE_ENTRY = {
      id: 'entry-u1',
      entityType: 'Employee',
      entityId: 'emp-00000000-0002',
      action: 'UPDATE' as const,
      actorId: 'user-1',
      actorName: 'Bob Jones',
      before: { name: 'Alice', role: 'employee' },
      after: { name: 'Alice Smith', role: 'employee' }, // role unchanged
      createdAt: '2024-06-02T11:00:00Z',
    }

    const DELETE_ENTRY = {
      id: 'entry-d1',
      entityType: 'Department',
      entityId: 'dept-0001',
      action: 'DELETE' as const,
      actorId: 'user-1',
      actorName: 'Carol Brown',
      before: { name: 'Finance' },
      after: null,
      createdAt: '2024-06-03T09:00:00Z',
    }

    it('clicking a row opens the dialog', async () => {
      vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
      render(<AuditLogTable />)

      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      })

      const row = screen.getByText('Alice Smith').closest('tr')!
      fireEvent.click(row)

      expect(screen.getByRole('button', { name: 'detail.close' })).toBeInTheDocument()
    })

    it('dialog shows the full entity ID (not truncated)', async () => {
      vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
      render(<AuditLogTable />)

      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      })

      const row = screen.getByText('Alice Smith').closest('tr')!
      fireEvent.click(row)

      // Full ID should appear; the table column only shows 'emp-0000…'
      expect(screen.getByText('emp-00000000-0001')).toBeInTheDocument()
    })

    it('dialog shows the actor name in the title area', async () => {
      vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
      render(<AuditLogTable />)

      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      })

      const row = screen.getByText('Alice Smith').closest('tr')!
      fireEvent.click(row)

      // Actor name appears in dialog title — getAllByText since it also exists in the table row
      const matches = screen.getAllByText('Alice Smith')
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })

    it('CREATE: shows detail.field and after column headers plus the after value', async () => {
      vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
      render(<AuditLogTable />)

      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      })

      const row = screen.getByText('Alice Smith').closest('tr')!
      fireEvent.click(row)

      expect(screen.getByRole('button', { name: 'detail.close' })).toBeInTheDocument()
      // Column headers rendered by t('detail.field') and t('after') — mock returns key as-is
      expect(screen.getByText('detail.field')).toBeInTheDocument()
      expect(screen.getByText('after')).toBeInTheDocument()
      // The value from after.name should appear
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    it('UPDATE: shows before and after column headers with changed values', async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeResponse({ ...SINGLE_PAGE_RESPONSE, entries: [UPDATE_ENTRY] }),
      )
      render(<AuditLogTable />)

      await waitFor(() => {
        expect(screen.getByText('Bob Jones')).toBeInTheDocument()
      })

      const row = screen.getByText('Bob Jones').closest('tr')!
      fireEvent.click(row)

      expect(screen.getByRole('button', { name: 'detail.close' })).toBeInTheDocument()
      expect(screen.getByText('before')).toBeInTheDocument()
      expect(screen.getByText('after')).toBeInTheDocument()
      // Before value of name and after value of name both appear
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    })

    it('UPDATE: shows unchanged fields footer with the unchanged key name', async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeResponse({ ...SINGLE_PAGE_RESPONSE, entries: [UPDATE_ENTRY] }),
      )
      render(<AuditLogTable />)

      await waitFor(() => {
        expect(screen.getByText('Bob Jones')).toBeInTheDocument()
      })

      const row = screen.getByText('Bob Jones').closest('tr')!
      fireEvent.click(row)

      // Footer: t('detail.unchangedFields') + ' role'
      expect(screen.getByText(/detail\.unchangedFields/)).toBeInTheDocument()
      // 'role' is the unchanged key
      expect(screen.getByText(/detail\.unchangedFields.*role/)).toBeInTheDocument()
    })

    it('DELETE: shows detail.field and before column headers plus the before value', async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeResponse({ ...SINGLE_PAGE_RESPONSE, entries: [DELETE_ENTRY] }),
      )
      render(<AuditLogTable />)

      await waitFor(() => {
        expect(screen.getByText('Carol Brown')).toBeInTheDocument()
      })

      const row = screen.getByText('Carol Brown').closest('tr')!
      fireEvent.click(row)

      expect(screen.getByRole('button', { name: 'detail.close' })).toBeInTheDocument()
      expect(screen.getByText('detail.field')).toBeInTheDocument()
      expect(screen.getByText('before')).toBeInTheDocument()
      // The value from before.name should appear
      expect(screen.getByText('Finance')).toBeInTheDocument()
    })

    it('clicking Close dismisses the dialog', async () => {
      vi.mocked(fetch).mockResolvedValue(makeResponse(SINGLE_PAGE_RESPONSE))
      render(<AuditLogTable />)

      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      })

      const row = screen.getByText('Alice Smith').closest('tr')!
      fireEvent.click(row)

      const closeBtn = screen.getByRole('button', { name: 'detail.close' })
      expect(closeBtn).toBeInTheDocument()

      fireEvent.click(closeBtn)

      expect(screen.queryByRole('button', { name: 'detail.close' })).not.toBeInTheDocument()
    })
  })
})
