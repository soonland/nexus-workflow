import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import type { Session } from '../auth/roles'
import { makeFakeApi, makeMembership, makeTenant, makeUser, managerSession, operatorSession } from '../test/fakeApi'
import { UsersPage } from './UsersPage'

const operator: Session = { kind: 'user', ...operatorSession() }
const manager = (...tenants: string[]): Session => ({ kind: 'user', ...managerSession(...tenants) })

const ada = makeUser({
  id: 'ada',
  name: 'Ada',
  email: 'ada@example.com',
  memberships: [makeMembership({ id: 'a1', userId: 'ada', role: 'tenant_manager', tenantId: 'acme' })],
})
const grace = makeUser({
  id: 'grace',
  name: 'Grace',
  email: 'grace@example.com',
  hasPassword: false,
  memberships: [makeMembership({ id: 'g1', userId: 'grace', role: 'operator' }), makeMembership({ id: 'g2', userId: 'grace', role: 'tenant_manager', tenantId: 'globex' })],
})
const gone = makeUser({ id: 'gone', name: 'Gone', email: 'gone@example.com', status: 'disabled' })

function setup(session: Session, users = [ada, grace, gone]) {
  const api = makeFakeApi()
  api.listUsers.mockResolvedValue(users)
  api.listTenants.mockResolvedValue([makeTenant({ id: 'acme' }), makeTenant({ id: 'globex' })])
  const user = userEvent.setup()
  render(<UsersPage api={api} session={session} />)
  return { api, user }
}

const render3 = (users: Parameters<typeof setup>[1]) => setup(operator, users)

const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr')!

describe('UsersPage', () => {
  describe('search and sort', () => {
    const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.querySelector('p')?.textContent)

    it('searches by name, email, role or status', async () => {
      const { user } = setup(operator)
      await screen.findByText('Ada')
      const box = screen.getByRole('searchbox', { name: 'Search people' })

      await user.type(box, 'globex') // Grace manages globex
      expect(names()).toEqual(['Grace'])

      await user.clear(box)
      await user.type(box, 'invited') // Grace has not accepted her invitation
      expect(names()).toEqual(['Grace'])

      await user.clear(box)
      await user.type(box, 'DISABLED')
      expect(names()).toEqual(['Gone'])
    })

    it('sorts by person, and reverses on a second click', async () => {
      const { user } = setup(operator)
      await screen.findByText('Ada')

      await user.click(screen.getByRole('button', { name: 'Person' }))
      expect(names()).toEqual(['Ada', 'Gone', 'Grace'])
      await user.click(screen.getByRole('button', { name: 'Person' }))
      expect(names()).toEqual(['Grace', 'Gone', 'Ada'])
    })

    it('sorts by last sign-in, with people who never signed in last', async () => {
      const recent = makeUser({ id: 'r', name: 'Recent', email: 'r@example.com', lastLoginAt: '2026-02-02T00:00:00.000Z' })
      const old = makeUser({ id: 'o', name: 'Old', email: 'o@example.com', lastLoginAt: '2026-01-01T00:00:00.000Z' })
      const never = makeUser({ id: 'n', name: 'Never', email: 'n@example.com', lastLoginAt: null })
      const { user } = render3([never, recent, old])
      await screen.findByText('Recent')

      await user.click(screen.getByRole('button', { name: 'Last sign-in' }))
      expect(names()).toEqual(['Old', 'Recent', 'Never'])
      await user.click(screen.getByRole('button', { name: 'Last sign-in' }))
      expect(names()).toEqual(['Recent', 'Old', 'Never'])
    })
  })

  it('lists people with their roles and whether they have signed up', async () => {
    setup(operator)

    const adaRow = await rowOf('Ada')
    expect(within(adaRow).getByText('manager · acme')).toBeInTheDocument()
    expect(within(adaRow).getByText('active')).toBeInTheDocument()
    const graceRow = await rowOf('Grace')
    expect(within(graceRow).getByText('operator')).toBeInTheDocument()
    expect(within(graceRow).getByText('invited')).toBeInTheDocument()
    expect(within(await rowOf('Gone')).getByText('disabled')).toBeInTheDocument()
  })

  it('shows a message and lets you retry when the list cannot be loaded', async () => {
    const api = makeFakeApi()
    api.listUsers.mockRejectedValueOnce(new ApiError(0, 'Could not reach the workflow API.')).mockResolvedValue([ada])
    api.listTenants.mockResolvedValue([])
    const user = userEvent.setup()
    render(<UsersPage api={api} session={operator} />)

    expect(await screen.findByText(/could not reach/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Ada')).toBeInTheDocument()
  })

  describe('inviting', () => {
    async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByRole('button', { name: /invite person/i }))
      await user.type(screen.getByLabelText(/^email/i), 'new@example.com')
      await user.type(screen.getByLabelText(/^name/i), 'Nora')
    }

    it('creates the person and shows the link once, as an absolute address', async () => {
      const { api, user } = setup(operator)
      await fillAndSubmit(user)
      await user.click(screen.getByRole('button', { name: /create and get link/i }))

      const field = await screen.findByLabelText('Invitation link')
      expect(field).toHaveValue(`${window.location.origin}/console/invite/t`)
      expect(api.createUser).toHaveBeenCalledWith({ email: 'new@example.com', name: 'Nora', memberships: [{ role: 'operator' }] })
    })

    it("prefers the server's own address when it knows one", async () => {
      const { api, user } = setup(operator)
      api.createUser.mockResolvedValue({
        user: makeUser(),
        invite: { token: 't', path: '/console/invite/t', url: 'https://nexus.example.com/console/invite/t', expiresAt: '2026-02-01T00:00:00.000Z' },
      })
      await fillAndSubmit(user)
      await user.click(screen.getByRole('button', { name: /create and get link/i }))

      expect(await screen.findByLabelText('Invitation link')).toHaveValue('https://nexus.example.com/console/invite/t')
    })

    it('lets an operator make a tenant manager for any tenant', async () => {
      const { api, user } = setup(operator)
      await fillAndSubmit(user)
      await user.click(screen.getByRole('combobox', { name: 'Role' }))
      await user.click(await screen.findByRole('option', { name: 'Tenant manager' }))
      await user.click(screen.getByRole('combobox', { name: 'Tenant' }))
      await user.click(await screen.findByRole('option', { name: 'globex' }))
      await user.click(screen.getByRole('button', { name: /create and get link/i }))

      await screen.findByLabelText('Invitation link')
      expect(api.createUser).toHaveBeenCalledWith({
        email: 'new@example.com',
        name: 'Nora',
        memberships: [{ role: 'tenant_manager', tenantId: 'globex' }],
      })
    })

    it('shows the reason when the person cannot be created and keeps the form', async () => {
      const { api, user } = setup(operator)
      api.createUser.mockRejectedValue(new ApiError(409, 'A user with this email already exists', 'CONFLICT'))
      await fillAndSubmit(user)
      await user.click(screen.getByRole('button', { name: /create and get link/i }))

      expect(await screen.findByText('A user with this email already exists')).toBeInTheDocument()
      expect(screen.getByLabelText(/^email/i)).toHaveValue('new@example.com')
    })

    it('copies the link to the clipboard', async () => {
      const { user } = setup(operator)
      await fillAndSubmit(user)
      await user.click(screen.getByRole('button', { name: /create and get link/i }))
      await screen.findByLabelText('Invitation link')

      await user.click(screen.getByRole('button', { name: /copy link/i }))

      expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/console/invite/t`)
      expect(await screen.findByText(/copied/i)).toBeInTheDocument()
    })

    it('forgets the link once the dialog is closed', async () => {
      const { user } = setup(operator)
      await fillAndSubmit(user)
      await user.click(screen.getByRole('button', { name: /create and get link/i }))
      await screen.findByLabelText('Invitation link')

      await user.click(screen.getByRole('button', { name: 'Done' }))

      await waitFor(() => expect(screen.queryByLabelText('Invitation link')).not.toBeInTheDocument())
    })
  })

  it('issues a new link for someone who lost theirs', async () => {
    const { api, user } = setup(operator)
    await rowOf('Grace')

    await user.click(screen.getByRole('button', { name: 'New invitation for grace@example.com' }))

    expect(api.reinviteUser).toHaveBeenCalledWith('grace')
    expect(await screen.findByLabelText('Invitation link')).toHaveValue(`${window.location.origin}/console/invite/t2`)
  })

  describe('disabling', () => {
    it('asks first, then disables and reloads', async () => {
      const { api, user } = setup(operator)
      await rowOf('Ada')

      await user.click(screen.getByRole('button', { name: 'Disable ada@example.com' }))
      expect(api.setUserStatus).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Disable' }))

      await waitFor(() => expect(api.setUserStatus).toHaveBeenCalledWith('ada', 'disabled'))
      await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(2))
    })

    it('re-enables a disabled person without asking', async () => {
      const { api, user } = setup(operator)
      await rowOf('Gone')

      await user.click(screen.getByRole('button', { name: 'Enable gone@example.com' }))

      await waitFor(() => expect(api.setUserStatus).toHaveBeenCalledWith('gone', 'active'))
    })

    it('offers no way to disable yourself', async () => {
      setup(operator, [makeUser({ id: 'op', name: 'Olive Operator', email: 'op@example.com' })])
      await rowOf('Olive Operator')

      expect(screen.queryByRole('button', { name: /disable op@example.com/i })).not.toBeInTheDocument()
    })

    it("shows the server's refusal", async () => {
      const { api, user } = setup(operator)
      api.setUserStatus.mockRejectedValue(new ApiError(409, 'There must always be one active operator', 'CONFLICT'))
      await rowOf('Grace')

      await user.click(screen.getByRole('button', { name: 'Disable grace@example.com' }))
      await user.click(screen.getByRole('button', { name: 'Disable' }))

      expect(await screen.findByText('There must always be one active operator')).toBeInTheDocument()
    })
  })

  describe('roles', () => {
    it('adds a role and removes one', async () => {
      const { api, user } = setup(operator)
      await rowOf('Grace')
      await user.click(screen.getByRole('button', { name: 'Roles of grace@example.com' }))
      const dialog = await screen.findByRole('dialog')

      await user.click(within(dialog).getByRole('button', { name: 'Remove Tenant manager of globex' }))
      await waitFor(() => expect(api.removeMembership).toHaveBeenCalledWith('grace', 'g2'))

      await user.click(within(dialog).getByRole('button', { name: 'Add role' }))
      await waitFor(() => expect(api.addMembership).toHaveBeenCalledWith('grace', { role: 'operator' }))
    })

    it("shows the server's refusal inside the dialog", async () => {
      const { api, user } = setup(operator)
      api.removeMembership.mockRejectedValue(new ApiError(409, 'You cannot remove your own operator role', 'CONFLICT'))
      await rowOf('Grace')
      await user.click(screen.getByRole('button', { name: 'Roles of grace@example.com' }))
      const dialog = await screen.findByRole('dialog')

      await user.click(within(dialog).getByRole('button', { name: 'Remove Operator' }))

      expect(await within(dialog).findByText('You cannot remove your own operator role')).toBeInTheDocument()
    })
  })

  describe('as a tenant manager', () => {
    it('does not load the tenant list (operators only) and says whose people these are', async () => {
      const { api } = setup(manager('acme'), [ada])

      expect(await screen.findByText('Ada')).toBeInTheDocument()
      expect(api.listTenants).not.toHaveBeenCalled()
      expect(screen.getByText(/your tenant \(acme\)/i)).toBeInTheDocument()
    })

    it('can only hand out the manager role, for the tenants they manage', async () => {
      const { api, user } = setup(manager('acme', 'initech'), [ada])
      await user.click(await screen.findByRole('button', { name: /invite person/i }))
      await user.type(screen.getByLabelText(/^email/i), 'new@example.com')
      await user.type(screen.getByLabelText(/^name/i), 'Nora')

      await user.click(screen.getByRole('combobox', { name: 'Role' }))
      expect(screen.queryByRole('option', { name: 'Operator' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('option', { name: 'Tenant manager' }))
      await user.click(screen.getByRole('combobox', { name: 'Tenant' }))
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['acme', 'initech'])
      await user.click(screen.getByRole('option', { name: 'initech' }))
      await user.click(screen.getByRole('button', { name: /create and get link/i }))

      await screen.findByLabelText('Invitation link')
      expect(api.createUser).toHaveBeenCalledWith({
        email: 'new@example.com',
        name: 'Nora',
        memberships: [{ role: 'tenant_manager', tenantId: 'initech' }],
      })
    })

    it('cannot remove roles outside their own tenants', async () => {
      const mixed = makeUser({
        id: 'mix',
        name: 'Mix',
        email: 'mix@example.com',
        memberships: [
          makeMembership({ id: 'x1', userId: 'mix', role: 'tenant_manager', tenantId: 'acme' }),
          makeMembership({ id: 'x2', userId: 'mix', role: 'tenant_manager', tenantId: 'globex' }),
        ],
      })
      const { user } = setup(manager('acme'), [mixed])
      await rowOf('Mix')
      await user.click(screen.getByRole('button', { name: 'Roles of mix@example.com' }))
      const dialog = await screen.findByRole('dialog')

      expect(within(dialog).getByRole('button', { name: 'Remove Tenant manager of acme' })).toBeInTheDocument()
      expect(within(dialog).queryByRole('button', { name: 'Remove Tenant manager of globex' })).not.toBeInTheDocument()
      expect(within(dialog).getByText('out of your scope')).toBeInTheDocument()
    })
  })
})
