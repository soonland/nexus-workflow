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
  render(<InstancesPage api={api} tenantId="acme" onOpen={() => undefined} />)
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

    const names = (id: string) => within(screen.getByText(id).closest('tr')!).queryAllByRole('button').filter((b) => !b.hasAttribute('title')).map((b) => b.textContent)
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

  it('opens an instance when its id is clicked', async () => {
    const api = makeFakeTenantApi()
    api.listInstances.mockResolvedValue({ items: [running], total: 1, page: 0, pageSize: 20 })
    const opened: string[] = []
    const user = userEvent.setup()
    render(<InstancesPage api={api} tenantId="acme" onOpen={(id) => opened.push(id)} />)

    await user.click(await screen.findByRole('button', { name: 'aaaaaaaa' }))

    expect(opened).toEqual(['aaaaaaaa-0000'])
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
    render(<InstancesPage api={api} tenantId="acme" onOpen={() => undefined} />)

    expect(await screen.findByText(/could not reach/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('aaaaaaaa')).toBeInTheDocument()
  })

  it('ignores a slow answer for an earlier filter that arrives after a newer one', async () => {
    const api = makeFakeTenantApi()
    let releaseSlow: (value: unknown) => void = () => undefined
    api.listInstances
      .mockImplementationOnce(() => new Promise((resolve) => (releaseSlow = resolve))) // the first load, for "all"
      .mockResolvedValue({ items: [paused], total: 1, page: 0, pageSize: 20 }) // the filtered load
    const user = userEvent.setup()
    render(<InstancesPage api={api} tenantId="acme" onOpen={() => undefined} />)

    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'suspended' }))
    await screen.findByText('bbbbbbbb')
    releaseSlow({ items: [running], total: 1, page: 0, pageSize: 20 }) // the old answer finally arrives

    await waitFor(() => expect(api.listInstances).toHaveBeenCalledTimes(2))
    expect(screen.getByText('bbbbbbbb')).toBeInTheDocument()
    expect(screen.queryByText('aaaaaaaa')).not.toBeInTheDocument()
  })

  it('steps back a page when the last row of the last page goes away', async () => {
    const api = makeFakeTenantApi()
    api.listInstances.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 0) return { items: [running], total: 21, page: 0, pageSize: 20 }
      return { items: [], total: 20, page, pageSize: 20 } // page 1 no longer exists
    })
    const user = userEvent.setup()
    render(<InstancesPage api={api} tenantId="acme" onOpen={() => undefined} />)
    await screen.findByText('aaaaaaaa')

    await user.click(screen.getByRole('button', { name: /next page/i }))

    await waitFor(() => expect(api.listInstances).toHaveBeenLastCalledWith({ page: 0, pageSize: 20 }))
    expect(await screen.findByText('aaaaaaaa')).toBeInTheDocument()
  })
})
