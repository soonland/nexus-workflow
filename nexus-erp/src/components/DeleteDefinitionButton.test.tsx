// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

// ── Component import (after mocks) ────────────────────────────────────────────

import DeleteDefinitionButton from './DeleteDefinitionButton'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeleteDefinitionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Initial render ────────────────────────────────────────────────────────────

  it('renders a Delete button', () => {
    render(<DeleteDefinitionButton definitionId="my-def" />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('disables the Delete button when disabled prop is true', () => {
    render(<DeleteDefinitionButton definitionId="my-def" disabled />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })

  // ── Dialog open/close ─────────────────────────────────────────────────────────

  it('opens the confirmation dialog on click', () => {
    render(<DeleteDefinitionButton definitionId="my-def" />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/permanently delete/i)).toBeInTheDocument()
    expect(screen.getByText('my-def')).toBeInTheDocument()
  })

  it('closes the dialog when Cancel is clicked', async () => {
    render(<DeleteDefinitionButton definitionId="my-def" />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  // ── Successful delete ─────────────────────────────────────────────────────────

  it('DELETEs the definition and refreshes on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response)

    render(<DeleteDefinitionButton definitionId="my-def" />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    // Click the confirm Delete button inside the dialog
    const dialogDeleteBtn = screen.getAllByRole('button', { name: /delete/i }).find(
      (btn) => btn.closest('[role="dialog"]'),
    )!
    fireEvent.click(dialogDeleteBtn)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/workflow/definitions/my-def',
        { method: 'DELETE' },
      )
      expect(mockRefresh).toHaveBeenCalledOnce()
    })

    // Dialog should close after success
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  // ── 409 conflict ─────────────────────────────────────────────────────────────

  it('shows a conflict error message on 409 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 409 } as Response)

    render(<DeleteDefinitionButton definitionId="my-def" />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    const dialogDeleteBtn = screen.getAllByRole('button', { name: /delete/i }).find(
      (btn) => btn.closest('[role="dialog"]'),
    )!
    fireEvent.click(dialogDeleteBtn)

    await waitFor(() => {
      expect(screen.getByText(/cannot delete.*pending/i)).toBeInTheDocument()
    })
    // Dialog stays open so the user can read the error
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  // ── Generic failure ───────────────────────────────────────────────────────────

  it('shows a generic error message on non-409 failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response)

    render(<DeleteDefinitionButton definitionId="my-def" />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    const dialogDeleteBtn = screen.getAllByRole('button', { name: /delete/i }).find(
      (btn) => btn.closest('[role="dialog"]'),
    )!
    fireEvent.click(dialogDeleteBtn)

    await waitFor(() => {
      expect(screen.getByText(/failed to delete/i)).toBeInTheDocument()
    })
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  // ── Network error ─────────────────────────────────────────────────────────────

  it('shows a network error message when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network failure'))

    render(<DeleteDefinitionButton definitionId="my-def" />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    const dialogDeleteBtn = screen.getAllByRole('button', { name: /delete/i }).find(
      (btn) => btn.closest('[role="dialog"]'),
    )!
    fireEvent.click(dialogDeleteBtn)

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })
  })
})
