// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, _params?: Record<string, unknown>) => key,
}))

// ── Component import (after mocks) ────────────────────────────────────────────

import AuditLogPanel from './AuditLogPanel'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENTITY_TYPE = 'Employee'
const ENTITY_ID = 'emp-123'

const makeResponse = (data: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }) as Response

const EMPTY_RESPONSE = {
  entries: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
}

const ENTRIES_RESPONSE = {
  entries: [
    {
      id: 'entry-1',
      entityType: 'Employee',
      entityId: 'emp-123',
      action: 'CREATE' as const,
      actorId: 'user-1',
      actorName: 'Alice Smith',
      before: null,
      after: { name: 'Alice' },
      createdAt: '2024-06-01T10:00:00Z',
    },
    {
      id: 'entry-2',
      entityType: 'Employee',
      entityId: 'emp-123',
      action: 'UPDATE' as const,
      actorId: 'user-2',
      actorName: 'Bob Jones',
      before: { name: 'Alice' },
      after: { name: 'Alice Smith' },
      createdAt: '2024-06-02T11:00:00Z',
    },
    {
      id: 'entry-3',
      entityType: 'Employee',
      entityId: 'emp-123',
      action: 'DELETE' as const,
      actorId: 'user-1',
      actorName: 'Alice Smith',
      before: null,
      after: null,
      createdAt: '2024-06-03T12:00:00Z',
    },
  ],
  total: 3,
  page: 1,
  pageSize: 20,
  totalPages: 1,
}

const PAGINATED_RESPONSE = {
  ...ENTRIES_RESPONSE,
  totalPages: 3,
  page: 1,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuditLogPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Toggle button ─────────────────────────────────────────────────────────

  it('renders the "show history" toggle button on initial render', () => {
    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    expect(screen.getByRole('button', { name: /history\.showHistory/i })).toBeInTheDocument()
  })

  it('changes button text to hideHistory when clicked', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(EMPTY_RESPONSE))
    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)

    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /history\.hideHistory/i })).toBeInTheDocument()
    })
  })

  // ── Fetch behaviour ───────────────────────────────────────────────────────

  it('does NOT call fetch on initial render (panel is closed)', () => {
    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches /api/audit-log with entityType and entityId when panel is opened', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(EMPTY_RESPONSE))
    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)

    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/audit-log?entityType=${ENTITY_TYPE}&entityId=${ENTITY_ID}`,
      )
    })
  })

  it('does not re-fetch when toggled closed then open again (data is cached)', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(EMPTY_RESPONSE))
    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)

    const btn = screen.getByRole('button', { name: /history\.showHistory/i })
    fireEvent.click(btn)
    await waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })

    // Close then re-open
    fireEvent.click(screen.getByRole('button', { name: /history\.hideHistory/i }))
    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    // Should still only have been called once
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  // ── Loading state ─────────────────────────────────────────────────────────

  it('shows a CircularProgress while the fetch is pending', async () => {
    let resolve!: (r: Response) => void
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((r) => { resolve = r }))

    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    resolve(makeResponse(EMPTY_RESPONSE))
  })

  // ── Error state ───────────────────────────────────────────────────────────

  it('shows an error message when the fetch returns a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    } as Response)

    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument()
    })
  })

  it('shows "Failed to load" when the non-ok response has no error field', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeInTheDocument()
    })
  })

  // ── Empty state ───────────────────────────────────────────────────────────

  it('shows history.empty when the entries array is empty', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(EMPTY_RESPONSE))

    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      expect(screen.getByText('history.empty')).toBeInTheDocument()
    })
  })

  // ── Entries ───────────────────────────────────────────────────────────────

  it('renders actor names when entries are loaded', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(ENTRIES_RESPONSE))

    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      // Alice Smith appears twice (entry-1 CREATE and entry-3 DELETE)
      expect(screen.getAllByText('Alice Smith')).toHaveLength(2)
      expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    })
  })

  it('renders action chip labels for each entry', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(ENTRIES_RESPONSE))

    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      // Translation mock returns keys as-is: actions.CREATE, actions.UPDATE, actions.DELETE
      expect(screen.getByText('actions.CREATE')).toBeInTheDocument()
      expect(screen.getByText('actions.UPDATE')).toBeInTheDocument()
      expect(screen.getByText('actions.DELETE')).toBeInTheDocument()
    })
  })

  // ── Diff summary ──────────────────────────────────────────────────────────

  it('shows — in the diff summary when both before and after are null', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(ENTRIES_RESPONSE))

    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      // entry-3 has before: null and after: null → summariseDiff returns '—'
      expect(screen.getByText(/·\s*—/)).toBeInTheDocument()
    })
  })

  // ── Pagination ────────────────────────────────────────────────────────────

  it('shows pagination.page text when totalPages > 1', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(PAGINATED_RESPONSE))

    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      expect(screen.getByText('pagination.page')).toBeInTheDocument()
    })
  })

  it('does NOT show pagination text when totalPages === 1', async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(ENTRIES_RESPONSE))

    render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /history\.showHistory/i }))

    await waitFor(() => {
      expect(screen.queryByText('pagination.page')).not.toBeInTheDocument()
    })
  })

  // ── 403 Forbidden ─────────────────────────────────────────────────────────

  it('renders nothing (null) when the API returns 403', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    } as Response)

    const { container } = render(<AuditLogPanel entityType={ENTITY_TYPE} entityId={ENTITY_ID} />)

    // Click to trigger the fetch
    const btn = screen.queryByRole('button', { name: /history\.showHistory/i })
    if (btn) fireEvent.click(btn)

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })
})
