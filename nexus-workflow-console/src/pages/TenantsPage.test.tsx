import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import { makeFakeApi, makeKey, makeTenant } from '../test/fakeApi'
import { TenantsPage } from './TenantsPage'

const acme = makeTenant()
const suspended = makeTenant({ id: 'globex', name: 'Globex', status: 'suspended', activeKeyCount: 0 })
const deleting = makeTenant({ id: 'initech', name: 'Initech', status: 'deleting' })
const defaultTenant = makeTenant({ id: 'default', name: 'Default Tenant' })

function setup(tenants = [acme, suspended, deleting, defaultTenant]) {
  const api = makeFakeApi()
  api.listTenants.mockResolvedValue(tenants)
  const user = userEvent.setup()
  render(<TenantsPage api={api} />)
  return { api, user }
}

describe('TenantsPage', () => {
  describe('search and sort', () => {
    const counts = (running: number, tasks: number) => ({ instances: { pending: 0, active: running, suspended: 0, completed: 0, terminated: 0 }, pendingTasks: tasks })
    const list = [
      makeTenant({ id: 'zeta', name: 'Zeta Ltd', activeKeyCount: 2, counts: counts(9, 4), createdAt: '2026-01-03T00:00:00.000Z' }),
      makeTenant({ id: 'alpha', name: 'Alpha Inc', activeKeyCount: 11, counts: counts(30, 1), createdAt: '2026-01-01T00:00:00.000Z' }),
      makeTenant({ id: 'mid', name: 'Middle Co', status: 'suspended', activeKeyCount: 0, counts: counts(2, 0), createdAt: '2026-01-02T00:00:00.000Z' }),
    ]
    const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.querySelector('p')?.textContent)

    it('searches by name, id or status', async () => {
      const { user } = setup(list)
      await screen.findByText('Zeta Ltd')

      await user.type(screen.getByRole('searchbox', { name: 'Search tenants' }), 'suspended')

      expect(names()).toEqual(['Middle Co'])
      expect(screen.getByText('Showing 1 to 1 of 1 entries (filtered from 3)')).toBeInTheDocument()
    })

    it('sorts by name, and by number columns as numbers', async () => {
      const { user } = setup(list)
      await screen.findByText('Zeta Ltd')

      await user.click(screen.getByRole('button', { name: 'Tenant' }))
      expect(names()).toEqual(['Alpha Inc', 'Middle Co', 'Zeta Ltd'])

      await user.click(screen.getByRole('button', { name: 'Active keys' })) // 0, 2, 11 (not "0, 11, 2")
      expect(names()).toEqual(['Middle Co', 'Zeta Ltd', 'Alpha Inc'])

      await user.click(screen.getByRole('button', { name: 'Running' }))
      await user.click(screen.getByRole('button', { name: 'Running' }))
      expect(names()).toEqual(['Alpha Inc', 'Zeta Ltd', 'Middle Co'])
    })

    it('puts tenants whose numbers are unknown last, whichever way it sorts', async () => {
      const { user } = setup([...list, makeTenant({ id: 'gone', name: 'Going Co', status: 'deleting', counts: null })])
      await screen.findByText('Zeta Ltd')

      await user.click(screen.getByRole('button', { name: 'Running' }))
      expect(names().at(-1)).toBe('Going Co')
      await user.click(screen.getByRole('button', { name: 'Running' }))
      expect(names().at(-1)).toBe('Going Co')
    })
  })

  it('shows how busy each tenant is: running and suspended instances and open tasks', async () => {
    const busy = makeTenant({
      id: 'busy',
      name: 'Busy Co',
      counts: { instances: { pending: 0, active: 12, suspended: 3, completed: 40, terminated: 1 }, pendingTasks: 7 },
    })
    setup([busy])

    const row = (await screen.findByText('Busy Co')).closest('tr')!
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent)
    // name, status, keys, running, suspended, open tasks, created, actions
    expect(cells.slice(3, 6)).toEqual(['12', '3', '7'])
  })

  it('shows zeros for a tenant with no work, and a dash where the numbers are not known', async () => {
    const idle = makeTenant({ id: 'idle', name: 'Idle Co', counts: { instances: { pending: 0, active: 0, suspended: 0, completed: 0, terminated: 0 }, pendingTasks: 0 } })
    const unknown = makeTenant({ id: 'gone', name: 'Going Co', status: 'deleting', counts: null })
    setup([idle, unknown])

    const idleCells = within((await screen.findByText('Idle Co')).closest('tr')!).getAllByRole('cell').map((c) => c.textContent)
    const unknownCells = within(screen.getByText('Going Co').closest('tr')!).getAllByRole('cell').map((c) => c.textContent)
    expect(idleCells.slice(3, 6)).toEqual(['0', '0', '0'])
    expect(unknownCells.slice(3, 6)).toEqual(['—', '—', '—'])
  })

  it('lists tenants with their status and active key count', async () => {
    setup()

    const row = (await screen.findByText('Acme Corp')).closest('tr')!
    expect(within(row).getByText('active')).toBeInTheDocument()
    expect(within(row).getByText('1')).toBeInTheDocument()
    const globex = screen.getByText('Globex').closest('tr')!
    expect(within(globex).getByText('suspended')).toBeInTheDocument()
    expect(within(screen.getByText('Initech').closest('tr')!).getByText('deleting')).toBeInTheDocument()
  })

  it('shows a message and lets you retry when the list cannot be loaded', async () => {
    const api = makeFakeApi()
    api.listTenants.mockRejectedValueOnce(new ApiError(0, 'Could not reach the workflow API.')).mockResolvedValue([acme])
    const user = userEvent.setup()
    render(<TenantsPage api={api} />)

    expect(await screen.findByText(/could not reach the workflow api/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
  })

  it('suspends an active tenant and reloads', async () => {
    const { api, user } = setup()
    await screen.findByText('Acme Corp')

    await user.click(screen.getByRole('button', { name: 'Suspend acme' }))

    await waitFor(() => expect(api.updateTenant).toHaveBeenCalledWith('acme', { status: 'suspended' }))
    expect(await screen.findByText('Suspended acme')).toBeInTheDocument()
    expect(api.listTenants).toHaveBeenCalledTimes(2)
  })

  it('reactivates a suspended tenant', async () => {
    const { api, user } = setup()
    await screen.findByText('Globex')

    await user.click(screen.getByRole('button', { name: 'Reactivate globex' }))

    await waitFor(() => expect(api.updateTenant).toHaveBeenCalledWith('globex', { status: 'active' }))
  })

  it('reports a failed action', async () => {
    const { api, user } = setup()
    api.updateTenant.mockRejectedValue(new ApiError(500, 'boom'))
    await screen.findByText('Acme Corp')

    await user.click(screen.getByRole('button', { name: 'Suspend acme' }))

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('only deletes after the tenant id has been typed', async () => {
    const { api, user } = setup()
    await screen.findByText('Acme Corp')

    await user.click(screen.getByRole('button', { name: 'Delete acme' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Delete tenant' })
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/type "acme" to confirm/i), 'acm')
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/type "acme" to confirm/i), 'e')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(api.deleteTenant).toHaveBeenCalledWith('acme'))
    expect(await screen.findByText('Deleted acme')).toBeInTheDocument()
  })

  it('does not delete when the confirmation is cancelled', async () => {
    const { api, user } = setup()
    await screen.findByText('Acme Corp')

    await user.click(screen.getByRole('button', { name: 'Delete acme' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(api.deleteTenant).not.toHaveBeenCalled()
  })

  it('offers to retry the delete of a tenant stuck in "deleting"', async () => {
    const { api, user } = setup()
    await screen.findByText('Initech')

    await user.click(screen.getByRole('button', { name: 'Retry delete initech' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/type "initech" to confirm/i), 'initech')
    await user.click(within(dialog).getByRole('button', { name: 'Retry delete' }))

    await waitFor(() => expect(api.deleteTenant).toHaveBeenCalledWith('initech'))
  })

  it('does not offer suspend/reactivate for a tenant that is being deleted', async () => {
    setup()
    await screen.findByText('Initech')

    expect(screen.queryByRole('button', { name: 'Suspend initech' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reactivate initech' })).not.toBeInTheDocument()
  })

  it('cannot delete the default tenant', async () => {
    setup()
    await screen.findByText('Default Tenant')

    expect(screen.getByRole('button', { name: 'Delete default' })).toBeDisabled()
  })

  describe('new tenant', () => {
    it('validates the id and creates the tenant', async () => {
      const { api, user } = setup([])
      api.createTenant.mockImplementation(async (id: string, name: string) => makeTenant({ id, name }))
      await screen.findByText('No tenants yet')

      await user.click(screen.getByRole('button', { name: 'New tenant' }))
      const dialog = await screen.findByRole('dialog')
      const create = within(dialog).getByRole('button', { name: 'Create tenant' })
      expect(create).toBeDisabled()

      await user.type(within(dialog).getByLabelText('Tenant id'), 'bad id!')
      await user.type(within(dialog).getByLabelText('Name'), 'Bad')
      expect(within(dialog).getByText(/only letters, digits, hyphens and underscores/i)).toBeInTheDocument()
      expect(create).toBeDisabled()

      await user.clear(within(dialog).getByLabelText('Tenant id'))
      await user.type(within(dialog).getByLabelText('Tenant id'), 'new-tenant_1')
      expect(create).toBeEnabled()
      await user.click(create)

      await waitFor(() => expect(api.createTenant).toHaveBeenCalledWith('new-tenant_1', 'Bad'))
      expect(await screen.findByText('Created new-tenant_1')).toBeInTheDocument()
    })

    it('shows the API error, for example when the tenant already exists', async () => {
      const { api, user } = setup([])
      api.createTenant.mockRejectedValue(new ApiError(409, "Tenant 'acme' already exists", 'CONFLICT'))
      await screen.findByText('No tenants yet')

      await user.click(screen.getByRole('button', { name: 'New tenant' }))
      const dialog = await screen.findByRole('dialog')
      await user.type(within(dialog).getByLabelText('Tenant id'), 'acme')
      await user.type(within(dialog).getByLabelText('Name'), 'Acme')
      await user.click(within(dialog).getByRole('button', { name: 'Create tenant' }))

      expect(await within(dialog).findByText("Tenant 'acme' already exists")).toBeInTheDocument()
    })
  })

  describe('API keys', () => {
    it('lists the keys of a tenant, marking revoked ones', async () => {
      const { api, user } = setup()
      api.listKeys.mockResolvedValue([makeKey({ name: 'ci' }), makeKey({ id: 'key-2', name: 'old', revokedAt: '2026-02-01T00:00:00.000Z' })])
      await screen.findByText('Acme Corp')

      await user.click(screen.getByRole('button', { name: 'Keys for acme' }))

      expect(await screen.findByText('ci')).toBeInTheDocument()
      expect(api.listKeys).toHaveBeenCalledWith('acme')
      expect(screen.getByText('revoked')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Revoke key ci' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Revoke key old' })).not.toBeInTheDocument()
    })

    it('creates a key and shows the plaintext once', async () => {
      const { api, user } = setup()
      await screen.findByText('Acme Corp')
      await user.click(screen.getByRole('button', { name: 'Keys for acme' }))

      await user.type(await screen.findByLabelText('Key name'), 'deploy')
      await user.click(screen.getByRole('button', { name: 'Create key' }))

      await waitFor(() => expect(api.createKey).toHaveBeenCalledWith('acme', 'deploy'))
      expect(await screen.findByTestId('new-key')).toHaveTextContent('plain-secret-key')
      expect(screen.getByText(/only time the key is shown/i)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Done' }))
      await waitFor(() => expect(screen.queryByTestId('new-key')).not.toBeInTheDocument())
      // Creating a key changes the tenant's key count, so the list is reloaded
      expect(api.listTenants).toHaveBeenCalledTimes(2)
    })

    it('revokes a key after confirmation', async () => {
      const { api, user } = setup()
      api.listKeys.mockResolvedValue([makeKey({ name: 'ci' })])
      await screen.findByText('Acme Corp')
      await user.click(screen.getByRole('button', { name: 'Keys for acme' }))

      await user.click(await screen.findByRole('button', { name: 'Revoke key ci' }))
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke key' }))

      await waitFor(() => expect(api.revokeKey).toHaveBeenCalledWith('acme', 'key-1'))
    })

    it('does not allow new keys for a tenant that is not active', async () => {
      const { user } = setup()
      await screen.findByText('Globex')

      await user.click(screen.getByRole('button', { name: 'Keys for globex' }))

      expect(await screen.findByLabelText('Key name')).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled()
    })
  })
})
