// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockPush = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('./SidebarContext', () => ({
  useSidebar: () => ({ collapsed: false }),
}))

vi.mock('./AppSidebar', () => ({
  SIDEBAR_EXPANDED_WIDTH: 240,
  SIDEBAR_COLLAPSED_WIDTH: 64,
}))

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ themeId: 'default', setThemeId: vi.fn() }),
}))

vi.mock('@/lib/theme', () => ({
  THEMES: [
    { id: 'default', label: 'Default Theme', swatch: ['#aaa', '#bbb'] },
    { id: 'dark', label: 'Dark Theme', swatch: ['#111', '#222'] },
  ],
}))

// ── Component import ──────────────────────────────────────────────────────────

import TopBar from './TopBar'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_PROPS = {
  email: 'alice@example.com',
  employeeId: 'emp-1',
  role: 'manager' as const,
  signOutAction: vi.fn().mockResolvedValue(undefined),
  userId: 'user-1',
}

function renderTopBar(overrides: Partial<typeof BASE_PROPS> = {}) {
  return render(<TopBar {...BASE_PROPS} {...overrides} />)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Rendering ─────────────────────────────────────────────────────────────────

  it('renders the role chip', () => {
    renderTopBar()
    expect(screen.getByText('manager')).toBeInTheDocument()
  })

  it('renders the employee role chip for employee role', () => {
    renderTopBar({ role: 'employee' })
    expect(screen.getByText('employee')).toBeInTheDocument()
  })

  it('renders the breadcrumb with home label', () => {
    renderTopBar()
    // useTranslations returns key — topBar.home is "home"
    expect(screen.getByText('home')).toBeInTheDocument()
  })

  it('renders the account menu icon button', () => {
    renderTopBar()
    expect(screen.getByRole('button', { name: /accountMenu/i })).toBeInTheDocument()
  })

  it('renders the messages icon button', () => {
    renderTopBar()
    expect(screen.getByRole('link', { name: /unreadMessages/i })).toBeInTheDocument()
  })

  // ── Unread message badge ──────────────────────────────────────────────────────

  it('does not show a badge count when unreadMessages is 0', () => {
    renderTopBar({ ...BASE_PROPS, unreadMessages: 0 })
    // Badge text should not be visible
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('shows badge count when unreadMessages > 0', () => {
    renderTopBar({ ...BASE_PROPS, unreadMessages: 3 })
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  // ── Account menu ─────────────────────────────────────────────────────────────

  it('opens the account menu when avatar is clicked', async () => {
    renderTopBar()
    fireEvent.click(screen.getByRole('button', { name: /accountMenu/i }))

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    })
  })

  it('renders theme options in the account menu', async () => {
    renderTopBar()
    fireEvent.click(screen.getByRole('button', { name: /accountMenu/i }))

    await waitFor(() => {
      expect(screen.getByText('Default Theme')).toBeInTheDocument()
      expect(screen.getByText('Dark Theme')).toBeInTheDocument()
    })
  })

  it('renders "My Profile" option when employeeId is provided', async () => {
    renderTopBar()
    fireEvent.click(screen.getByRole('button', { name: /accountMenu/i }))

    await waitFor(() => {
      expect(screen.getByText('myProfile')).toBeInTheDocument()
    })
  })

  it('does not render "My Profile" when employeeId is null', async () => {
    renderTopBar({ employeeId: null })
    fireEvent.click(screen.getByRole('button', { name: /accountMenu/i }))

    await waitFor(() => {
      expect(screen.queryByText('myProfile')).not.toBeInTheDocument()
    })
  })

  it('renders the Sign Out button in the account menu', async () => {
    renderTopBar()
    fireEvent.click(screen.getByRole('button', { name: /accountMenu/i }))

    await waitFor(() => {
      expect(screen.getByText('signOut')).toBeInTheDocument()
    })
  })

  // ── Theme change ──────────────────────────────────────────────────────────────

  it('calls fetch to PATCH user preferences when a theme is selected', async () => {
    renderTopBar()
    fireEvent.click(screen.getByRole('button', { name: /accountMenu/i }))

    await waitFor(() => {
      expect(screen.getByText('Dark Theme')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Dark Theme'))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/users/user-1/preferences',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })
})
