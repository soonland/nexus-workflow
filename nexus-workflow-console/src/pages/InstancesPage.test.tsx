import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import type { InstanceSummary } from '../api/types'
import { makeFakeTenantApi, makeInstance } from '../test/fakeApi'
import { InstancesPage } from './InstancesPage'

const running = makeInstance({ id: 'aaaaaaaa-0000', status: 'active', businessKey: 'order-17' })
const paused = makeInstance({ id: 'bbbbbbbb-0000', status: 'suspended' })
const waiting = makeInstance({ id: 'cccccccc-0000', status: 'pending' })
const stopped = makeInstance({ id: 'dddddddd-0000', status: 'terminated' })
const done = makeInstance({ id: 'eeeeeeee-0000', status: 'completed' })

function setup(items: InstanceSummary[] = [running, paused, waiting, stopped, done], total = items.length) {
  const api = makeFakeTenantApi()
  api.listInstances.mockResolvedValue({ items, total, page: 0, pageSize: 20 })
  const user = userEvent.setup()
  render(<InstancesPage api={api} tenantId="acme" />)
  return { api, user }
}

const row = async (shortId: string) => (await screen.findByText(shortId)).closest('tr')!

describe('InstancesPage', () => {
  it('lists instances with their status and business key', async () => {
    setup()

    const active = await row('aaaaaaaa')
    expect(within(active).getByText('active')).toBeInTheDocument()
    expect(within(active).getByText('order-17')).toBeInTheDocument()
    expect(within(await row('bbbbbbbb')).getByText('suspended')).toBeInTheDocument()
  })

  it('offers only the actions that make sense for each status', async () => {
    setup()
    await row('aaaaaaaa')

    const names = (id: string) => within(screen.getByText(id).closest('tr')!).queryAllByRole('button').map((b) => b.textContent)
    expect(names('aaaaaaaa')).toEqual(['Suspend', 'Cancel'])
    expect(names('bbbbbbbb')).toEqual(['Resume', 'Cancel'])
    expect(names('cccccccc')).toEqual(['Cancel'])
    expect(names('dddddddd')).toEqual(['Restart'])
    expect(names('eeeeeeee')).toEqual([])
  })

  it('suspends and resumes straight away, then reloads', async () => {
    const { api, user } = setup()
    await row('aaaaaaaa')

    await user.click(screen.getByRole('button', { name: 'Suspend aaaaaaaa' }))
    await waitFor(() => expect(api.suspendInstance).toHaveBeenCalledWith('aaaaaaaa-0000'))
    await waitFor(() => expect(api.listInstances).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole('button', { name: 'Resume bbbbbbbb' }))
    await waitFor(() => expect(api.resumeInstance).toHaveBeenCalledWith('bbbbbbbb-0000'))
  })

  it('asks before cancelling, and does nothing if you back out', async () => {
    const { api, user } = setup()
    await row('aaaaaaaa')

    await user.click(screen.getByRole('button', { name: 'Cancel aaaaaaaa' }))
    expect(api.cancelInstance).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' })) // the dialog's own back-out button
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.cancelInstance).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel aaaaaaaa' }))
    await user.click(screen.getByRole('button', { name: 'Cancel instance' }))
    await waitFor(() => expect(api.cancelInstance).toHaveBeenCalledWith('aaaaaaaa-0000'))
  })

  it('asks before restarting, and says a new instance is started', async () => {
    const { api, user } = setup()
    await row('dddddddd')

    await user.click(screen.getByRole('button', { name: 'Restart dddddddd' }))
    expect(screen.getByText(/starts a/i)).toBeInTheDocument()
    expect(api.restartInstance).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Restart' }))

    await waitFor(() => expect(api.restartInstance).toHaveBeenCalledWith('dddddddd-0000'))
    expect(await screen.findByText(/restarted dddddddd as a new instance/i)).toBeInTheDocument()
  })

  it("shows the server's refusal", async () => {
    const { api, user } = setup()
    api.suspendInstance.mockRejectedValue(new ApiError(422, 'Instance is not active (status: completed)', 'INVALID_STATE'))
    await row('aaaaaaaa')

    await user.click(screen.getByRole('button', { name: 'Suspend aaaaaaaa' }))

    expect(await screen.findByText('Instance is not active (status: completed)')).toBeInTheDocument()
  })

  it('filters by status and goes back to the first page', async () => {
    const { api, user } = setup()
    await row('aaaaaaaa')

    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'suspended' }))

    await waitFor(() => expect(api.listInstances).toHaveBeenLastCalledWith({ status: 'suspended', page: 0, pageSize: 20 }))
  })

  it('pages through long lists', async () => {
    const { api, user } = setup([running], 45)
    await row('aaaaaaaa')
    expect(screen.getByText('1–20 of 45')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next page/i }))

    await waitFor(() => expect(api.listInstances).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 }))
  })

  it('shows a message and lets you retry when the list cannot be loaded', async () => {
    const api = makeFakeTenantApi()
    api.listInstances.mockRejectedValueOnce(new ApiError(0, 'Could not reach the workflow API.')).mockResolvedValue({ items: [running], total: 1, page: 0, pageSize: 20 })
    const user = userEvent.setup()
    render(<InstancesPage api={api} tenantId="acme" />)

    expect(await screen.findByText(/could not reach/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('aaaaaaaa')).toBeInTheDocument()
  })
})
