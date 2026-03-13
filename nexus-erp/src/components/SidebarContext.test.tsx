// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import * as React from 'react'

import { SidebarProvider, useSidebar } from './SidebarContext'

// ── Helper: consumer component ─────────────────────────────────────────────────

const Consumer = () => {
  const { collapsed, setCollapsed } = useSidebar()
  return (
    <div>
      <span data-testid="state">{collapsed ? 'collapsed' : 'expanded'}</span>
      <button onClick={() => setCollapsed(true)}>collapse</button>
      <button onClick={() => setCollapsed((prev) => !prev)}>toggle</button>
    </div>
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SidebarContext', () => {
  afterEach(() => cleanup())
  it('provides collapsed=false by default', () => {
    render(
      <SidebarProvider>
        <Consumer />
      </SidebarProvider>,
    )
    expect(screen.getByTestId('state')).toHaveTextContent('expanded')
  })

  it('setCollapsed(true) collapses the sidebar', () => {
    render(
      <SidebarProvider>
        <Consumer />
      </SidebarProvider>,
    )
    fireEvent.click(screen.getByText('collapse'))
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed')
  })

  it('setCollapsed with updater function toggles the value', () => {
    render(
      <SidebarProvider>
        <Consumer />
      </SidebarProvider>,
    )
    expect(screen.getByTestId('state')).toHaveTextContent('expanded')
    fireEvent.click(screen.getByText('toggle'))
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed')
    fireEvent.click(screen.getByText('toggle'))
    expect(screen.getByTestId('state')).toHaveTextContent('expanded')
  })

  it('useSidebar returns the default no-op context outside provider', () => {
    // Should not throw — the default context is a safe no-op
    const Standalone = () => {
      const { collapsed } = useSidebar()
      return <span>{collapsed ? 'collapsed' : 'expanded'}</span>
    }
    render(<Standalone />)
    expect(screen.getByText('expanded')).toBeInTheDocument()
  })
})
