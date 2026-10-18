import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material'
import { theme } from '../theme'
import { ThemeMenu } from './ThemeMenu'

function setup() {
  const view = () => (
    <ThemeProvider theme={theme} defaultMode="system">
      <ThemeMenu />
    </ThemeProvider>
  )
  const result = render(view())
  return { user: userEvent.setup(), remount: () => { result.unmount(); render(view()) } }
}

describe('ThemeMenu', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('offers System, Light and Dark and starts on System', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'Theme' }))

    expect(screen.getByRole('menuitem', { name: 'System' })).toHaveClass('Mui-selected')
    expect(screen.getByRole('menuitem', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Dark' })).toBeInTheDocument()
  })

  it('switches immediately and remembers the choice', async () => {
    const { user, remount } = setup()

    await user.click(screen.getByRole('button', { name: 'Theme' }))
    await user.click(screen.getByRole('menuitem', { name: 'Dark' }))
    expect(document.documentElement).toHaveClass('dark')

    remount()
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    expect(screen.getByRole('menuitem', { name: 'Dark' })).toHaveClass('Mui-selected')
  })

  it('follows the OS setting while on System', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }))
    setup()

    expect(document.documentElement).toHaveClass('dark')
  })

  it('goes back to Light', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'Theme' }))
    await user.click(screen.getByRole('menuitem', { name: 'Dark' }))
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    await user.click(screen.getByRole('menuitem', { name: 'Light' }))

    expect(document.documentElement).not.toHaveClass('dark')
  })
})
