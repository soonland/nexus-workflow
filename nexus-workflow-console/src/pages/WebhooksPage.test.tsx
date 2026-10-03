import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import { makeFakeTenantApi, makeWebhook } from '../test/fakeApi'
import { WebhooksPage } from './WebhooksPage'

const all = makeWebhook({ id: 'h1', url: 'https://example.com/all' })
const some = makeWebhook({ id: 'h2', url: 'https://example.com/some', events: ['ProcessInstanceCompleted'] })

function setup(webhooks = [all, some]) {
  const api = makeFakeTenantApi()
  api.listWebhooks.mockResolvedValue(webhooks)
  const user = userEvent.setup()
  render(<WebhooksPage api={api} tenantId="acme" />)
  return { api, user }
}

describe('WebhooksPage', () => {
  it('lists webhooks with the events they listen to', async () => {
    setup()

    expect(within((await screen.findByText('https://example.com/all')).closest('tr')!).getByText('all events')).toBeInTheDocument()
    expect(within(screen.getByText('https://example.com/some').closest('tr')!).getByText('ProcessInstanceCompleted')).toBeInTheDocument()
  })

  it('says so when there are none', async () => {
    setup([])
    expect(await screen.findByText(/no webhooks yet/i)).toBeInTheDocument()
  })

  it('adds a webhook with events and a secret, then reloads', async () => {
    const { api, user } = setup()
    await screen.findByText('https://example.com/all')

    await user.click(screen.getByRole('button', { name: /add webhook/i }))
    await user.type(screen.getByLabelText(/^address/i), 'https://new.example.com/hook')
    await user.type(screen.getByLabelText(/^events/i), 'ProcessInstanceStarted, ProcessInstanceCompleted')
    await user.type(screen.getByLabelText(/^signing secret/i), 's3cret')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add webhook' }))

    await waitFor(() =>
      expect(api.createWebhook).toHaveBeenCalledWith({
        url: 'https://new.example.com/hook',
        events: ['ProcessInstanceStarted', 'ProcessInstanceCompleted'],
        secret: 's3cret',
      }),
    )
    await waitFor(() => expect(api.listWebhooks).toHaveBeenCalledTimes(2))
  })

  it('sends only the address when nothing else is given', async () => {
    const { api, user } = setup()
    await screen.findByText('https://example.com/all')

    await user.click(screen.getByRole('button', { name: /add webhook/i }))
    await user.type(screen.getByLabelText(/^address/i), 'https://new.example.com/hook')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add webhook' }))

    await waitFor(() => expect(api.createWebhook).toHaveBeenCalledWith({ url: 'https://new.example.com/hook' }))
  })

  it('shows the reason and keeps the form when the webhook is refused', async () => {
    const { api, user } = setup()
    api.createWebhook.mockRejectedValue(new ApiError(400, 'Invalid url', 'VALIDATION_ERROR'))
    await screen.findByText('https://example.com/all')

    await user.click(screen.getByRole('button', { name: /add webhook/i }))
    await user.type(screen.getByLabelText(/^address/i), 'https://bad.example.com')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add webhook' }))

    expect(await screen.findByText('Invalid url')).toBeInTheDocument()
    expect(screen.getByLabelText(/^address/i)).toHaveValue('https://bad.example.com')
  })

  it('asks before deleting, and does nothing if you back out', async () => {
    const { api, user } = setup()
    await screen.findByText('https://example.com/all')

    await user.click(screen.getByRole('button', { name: 'Delete webhook https://example.com/all' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.deleteWebhook).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete webhook https://example.com/all' }))
    await user.click(screen.getByRole('button', { name: 'Delete webhook' }))
    await waitFor(() => expect(api.deleteWebhook).toHaveBeenCalledWith('h1'))
  })

  it('shows a message and lets you retry when the list cannot be loaded', async () => {
    const api = makeFakeTenantApi()
    api.listWebhooks.mockRejectedValueOnce(new ApiError(0, 'Could not reach the workflow API.')).mockResolvedValue([all])
    const user = userEvent.setup()
    render(<WebhooksPage api={api} tenantId="acme" />)

    expect(await screen.findByText(/could not reach/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('https://example.com/all')).toBeInTheDocument()
  })
})
