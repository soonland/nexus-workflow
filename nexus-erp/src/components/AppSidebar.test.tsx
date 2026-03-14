// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockSetCollapsed = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard',
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('./SidebarContext', () => ({
  useSidebar: () => ({ collapsed: false, setCollapsed: mockSetCollapsed }),
}))

// ── Component import ──────────────────────────────────────────────────────────

import AppSidebar from './AppSidebar'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => cleanup())

  // ── Manager view ──────────────────────────────────────────────────────────────

  it('renders manager-only nav items when role=manager', () => {
    render(<AppSidebar role="manager" hasEmployee={true} />)
    // "items.employees" key is shown (translated as-is in mock)
    expect(screen.getByText('items.employees')).toBeInTheDocument()
    // Admin section items
    expect(screen.getByText('items.departments')).toBeInTheDocument()
    expect(screen.getByText('items.groups')).toBeInTheDocument()
  })

  // ── Employee view ─────────────────────────────────────────────────────────────

  it('hides manager-only nav items when role=employee', () => {
    render(<AppSidebar role="employee" hasEmployee={true} />)
    expect(screen.queryByText('items.employees')).not.toBeInTheDocument()
    expect(screen.queryByText('items.departments')).not.toBeInTheDocument()
    expect(screen.queryByText('items.groups')).not.toBeInTheDocument()
  })

  it('shows timesheets link when hasEmployee=true', () => {
    render(<AppSidebar role="employee" hasEmployee={true} />)
    expect(screen.getByText('items.timesheets')).toBeInTheDocument()
  })

  it('hides timesheets link when hasEmployee=false', () => {
    render(<AppSidebar role="employee" hasEmployee={false} />)
    expect(screen.queryByText('items.timesheets')).not.toBeInTheDocument()
  })

  // ── Common nav items ──────────────────────────────────────────────────────────

  it('renders common nav items for both roles', () => {
    render(<AppSidebar role="employee" hasEmployee={true} />)
    expect(screen.getByText('items.dashboard')).toBeInTheDocument()
    expect(screen.getByText('items.taskInbox')).toBeInTheDocument()
    expect(screen.getByText('items.messages')).toBeInTheDocument()
    expect(screen.getByText('items.organizations')).toBeInTheDocument()
  })

  // ── Brand header ─────────────────────────────────────────────────────────────

  it('shows Nexus ERP brand text when expanded', () => {
    render(<AppSidebar role="employee" hasEmployee={true} />)
    expect(screen.getByText('Nexus ERP')).toBeInTheDocument()
  })

  // ── Collapse toggle ───────────────────────────────────────────────────────────

  it('calls setCollapsed when the toggle button is clicked', () => {
    render(<AppSidebar role="employee" hasEmployee={true} />)
    const toggleBtn = screen.getByRole('button', { name: /collapseSidebar/i })
    fireEvent.click(toggleBtn)
    expect(mockSetCollapsed).toHaveBeenCalledOnce()
  })

  // ── Active item highlighting ───────────────────────────────────────────────────

  it('renders dashboard link with href=/dashboard', () => {
    render(<AppSidebar role="employee" hasEmployee={true} />)
    const dashboardLink = screen.getByRole('link', { name: /items\.dashboard/i })
    expect(dashboardLink).toHaveAttribute('href', '/dashboard')
  })
})
