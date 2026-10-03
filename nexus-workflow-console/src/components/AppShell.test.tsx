import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell, type Screen } from './AppShell'

function setup(screens: Screen[] = ['definitions', 'instances', 'tenants', 'users'], overrides = {}) {
  const onSelect = vi.fn()
  const onSignOut = vi.fn()
  const onSelectTenant = vi.fn()
  render(
    <AppShell
      screens={screens}
      screen={screens[0]}
      onSelect={onSelect}
      tenantId="acme"
      tenantIds={['acme']}
      onSelectTenant={onSelectTenant}
      who="Ada"
      onSignOut={onSignOut}
      {...overrides}
    >
      <p>page content</p>
    </AppShell>,
  )
  return { onSelect, onSignOut, onSelectTenant, user: userEvent.setup() }
}

const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))

describe('AppShell', () => {
  it('groups the sidebar by area and shows only the screens it is given', () => {
    setup(['definitions', 'instances', 'users'])

    expect(nav().getByRole('button', { name: 'Workflows' })).toBeInTheDocument()
    expect(nav().getByRole('button', { name: 'People' })).toBeInTheDocument()
    expect(nav().queryByRole('button', { name: 'Platform' })).not.toBeInTheDocument()
    expect(nav().queryByRole('button', { name: 'Tenants' })).not.toBeInTheDocument()
    expect(nav().getByRole('button', { name: 'Instances' })).toBeInTheDocument()
  })

  it('marks the current screen and reports clicks on another', async () => {
    const { onSelect, user } = setup()

    expect(nav().getByRole('button', { name: 'Definitions' })).toHaveAttribute('aria-current', 'page')
    expect(nav().getByRole('button', { name: 'Users' })).not.toHaveAttribute('aria-current')
    await user.click(nav().getByRole('button', { name: 'Users' }))

    expect(onSelect).toHaveBeenCalledWith('users')
  })

  it('collapses and reopens a group', async () => {
    const { user } = setup()

    await user.click(nav().getByRole('button', { name: 'Workflows' }))
    expect(nav().getByRole('button', { name: 'Workflows' })).toHaveAttribute('aria-expanded', 'false')
    await vi.waitFor(() => expect(nav().queryByRole('button', { name: 'Instances' })).not.toBeInTheDocument())
    expect(nav().getByRole('button', { name: 'Users' })).toBeInTheDocument() // other groups stay open

    await user.click(nav().getByRole('button', { name: 'Workflows' }))
    expect(await nav().findByRole('button', { name: 'Instances' })).toBeInTheDocument()
  })

  it('shows who is signed in, the tenant, and signs out', async () => {
    const { onSignOut, user } = setup()

    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Tenant: acme')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /sign out/i }))

    expect(onSignOut).toHaveBeenCalled()
  })

  it('shows the page in the content area', () => {
    setup()
    expect(screen.getByText('page content')).toBeInTheDocument()
  })
})
