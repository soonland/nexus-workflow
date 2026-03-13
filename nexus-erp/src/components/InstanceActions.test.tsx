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

import InstanceActions from './InstanceActions'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InstanceActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Status-based button visibility ───────────────────────────────────────────

  it('shows Suspend and Cancel for active status', () => {
    render(<InstanceActions instanceId="inst-1" status="active" />)
    expect(screen.getByRole('button', { name: /suspend/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart/i })).not.toBeInTheDocument()
  })

  it('shows Resume and Cancel for suspended status', () => {
    render(<InstanceActions instanceId="inst-1" status="suspended" />)
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart/i })).not.toBeInTheDocument()
  })

  it('shows only Restart for terminated status', () => {
    render(<InstanceActions instanceId="inst-1" status="terminated" />)
    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
  })

  it('shows no action buttons for completed status', () => {
    render(<InstanceActions instanceId="inst-1" status="completed" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  // ── Action calls ──────────────────────────────────────────────────────────────

  it('clicking Suspend POSTs to the correct endpoint and refreshes', async () => {
    render(<InstanceActions instanceId="inst-abc" status="active" />)
    fireEvent.click(screen.getByRole('button', { name: /suspend/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/workflow/instances/inst-abc/suspend',
        { method: 'POST' },
      )
      expect(mockRefresh).toHaveBeenCalledOnce()
    })
  })

  it('clicking Resume POSTs to the resume endpoint', async () => {
    render(<InstanceActions instanceId="inst-abc" status="suspended" />)
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/workflow/instances/inst-abc/resume',
        { method: 'POST' },
      )
    })
  })

  it('clicking Cancel POSTs to the cancel endpoint', async () => {
    render(<InstanceActions instanceId="inst-abc" status="active" />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/workflow/instances/inst-abc/cancel',
        { method: 'POST' },
      )
    })
  })

  it('clicking Restart POSTs to the restart endpoint', async () => {
    render(<InstanceActions instanceId="inst-abc" status="terminated" />)
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/workflow/instances/inst-abc/restart',
        { method: 'POST' },
      )
    })
  })

  // ── Busy state ────────────────────────────────────────────────────────────────

  it('disables all buttons while an action is in-flight', async () => {
    let resolveAction!: (v: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => { resolveAction = resolve }),
    )

    render(<InstanceActions instanceId="inst-1" status="active" />)
    fireEvent.click(screen.getByRole('button', { name: /suspend/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /suspend/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
    })

    resolveAction({ ok: true } as Response)
  })
})
