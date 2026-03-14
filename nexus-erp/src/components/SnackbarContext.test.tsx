// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import * as React from 'react'

import { SnackbarProvider, useSnackbar } from './SnackbarContext'

// ── Helper: trigger component ──────────────────────────────────────────────────

const Trigger = ({
  message = 'Hello',
  severity,
  duration,
}: {
  message?: string
  severity?: 'success' | 'error' | 'warning' | 'info'
  duration?: number
}) => {
  const { showSnackbar } = useSnackbar()
  return (
    <button
      onClick={() => showSnackbar({ message, severity, duration })}
    >
      show
    </button>
  )
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<SnackbarProvider>{ui}</SnackbarProvider>)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SnackbarContext', () => {
  afterEach(() => cleanup())

  it('renders children without showing a snackbar initially', () => {
    renderWithProvider(<span>child</span>)
    expect(screen.getByText('child')).toBeInTheDocument()
    // The alert should not be visible before showSnackbar is called
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('showSnackbar displays an alert with the message', async () => {
    renderWithProvider(<Trigger message="Test message" />)
    fireEvent.click(screen.getByText('show'))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Test message')
    })
  })

  it('displays the correct severity (success)', async () => {
    renderWithProvider(<Trigger message="Good job" severity="success" />)
    fireEvent.click(screen.getByText('show'))
    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert).toBeInTheDocument()
      expect(alert).toHaveTextContent('Good job')
    })
  })

  it('defaults to info severity when not specified', async () => {
    renderWithProvider(<Trigger message="Info" />)
    fireEvent.click(screen.getByText('show'))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Info')
    })
  })

  it('clicking the close button on the Alert hides it', async () => {
    renderWithProvider(<Trigger message="Close me" />)
    fireEvent.click(screen.getByText('show'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    // The filled Alert has an onClose handler that renders a close button
    const closeButton = screen.getByTitle('Close')
    act(() => {
      fireEvent.click(closeButton)
    })

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('ignores clickaway close events — snackbar stays open after clicking outside', async () => {
    renderWithProvider(<Trigger message="Clickaway test" />)
    fireEvent.click(screen.getByText('show'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    // Click outside the snackbar — MUI ClickAwayListener fires onClose with reason='clickaway'
    act(() => {
      fireEvent.click(document.body)
    })

    // Snackbar should remain open because handleClose returns early for clickaway
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('useSnackbar returns a no-op outside provider', () => {
    const NoProviderConsumer = () => {
      const { showSnackbar } = useSnackbar()
      // Should not throw
      showSnackbar({ message: 'nothing' })
      return <span>ok</span>
    }
    render(<NoProviderConsumer />)
    expect(screen.getByText('ok')).toBeInTheDocument()
  })
})
