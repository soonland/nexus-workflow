import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import type { OperatorKey } from '../api/types'
import { makeFakeApi, makeOperatorKey } from '../test/fakeApi'
import { OperatorKeysPage } from './OperatorKeysPage'

const active = makeOperatorKey({ id: 'a', name: 'provisioning script', lastUsedAt: '2026-03-05T10:00:00.000Z' })
const expiring = makeOperatorKey({ id: 'e', name: 'ci', expiresAt: '2099-01-01T00:00:00.000Z' })
const expired = makeOperatorKey({ id: 'x', name: 'old ci', expiresAt: '2020-01-01T00:00:00.000Z' })
const revoked = makeOperatorKey({ id: 'r', name: 'lost laptop', revokedAt: '2026-02-01T00:00:00.000Z' })

function setup(keys: OperatorKey[] = [active, expiring, expired, revoked]) {
  const api = makeFakeApi()
  api.listOperatorKeys.mockResolvedValue(keys)
  const user = userEvent.setup()
  render(<OperatorKeysPage api={api} />)
  return { api, user }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OperatorKeysPage', () => {
  it('lists the keys with their state, expiry and when they were last used', async () => {
    setup()

    const row = (name: string) => screen.getByText(name).closest('tr')!
    await screen.findByText('provisioning script')
    expect(within(row('provisioning script')).getByText('active')).toBeInTheDocument()
    expect(within(row('provisioning script')).getByText('never')).toBeInTheDocument() // does not expire
    expect(within(row('ci')).getByText('active')).toBeInTheDocument()
    expect(within(row('old ci')).getByText('expired')).toBeInTheDocument()
    expect(within(row('lost laptop')).getByText('revoked')).toBeInTheDocument()
  })

  it('offers Revoke on keys that still work, not on expired or revoked ones', async () => {
    setup()
    await screen.findByText('provisioning script')

    expect(screen.getByRole('button', { name: 'Revoke operator key provisioning script' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke operator key ci' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke operator key old ci' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke operator key lost laptop' })).not.toBeInTheDocument()
  })

  it('says what an operator key is, in particular that it never opens a tenant and cannot make keys', async () => {
    setup()

    expect(await screen.findByText(/never opens a tenant's own data/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot create other keys/i)).toBeInTheDocument()
  })

  it('says so when there are none', async () => {
    setup([])
    expect(await screen.findByText('No operator keys yet')).toBeInTheDocument()
  })

  it('searches by name or state', async () => {
    const { user } = setup()
    await screen.findByText('provisioning script')

    await user.type(screen.getByRole('searchbox', { name: 'Search operator keys' }), 'revoked')

    expect(screen.getByText('lost laptop')).toBeInTheDocument()
    expect(screen.queryByText('provisioning script')).not.toBeInTheDocument()
  })

  it('shows a message and lets you retry when the keys cannot be loaded', async () => {
    const api = makeFakeApi()
    api.listOperatorKeys.mockRejectedValueOnce(new ApiError(403, 'An operator key cannot manage operator keys', 'FORBIDDEN')).mockResolvedValue([active])
    const user = userEvent.setup()
    render(<OperatorKeysPage api={api} />)

    expect(await screen.findByText(/cannot manage operator keys/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('provisioning script')).toBeInTheDocument()
  })

  describe('creating', () => {
    async function open(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByRole('button', { name: /new operator key/i }))
    }

    it('creates a key with a name and shows the secret once, with a copy button', async () => {
      const { api, user } = setup([])
      await open(user)

      await user.type(screen.getByLabelText(/^name/i), '  deploy script ')
      await user.click(screen.getByRole('button', { name: 'Create key' }))

      await waitFor(() => expect(api.createOperatorKey).toHaveBeenCalledWith({ name: 'deploy script' }))
      expect(await screen.findByTestId('new-operator-key')).toHaveTextContent('nxop_secret')
      expect(screen.getByText(/only time the key is shown/i)).toBeInTheDocument()
      await waitFor(() => expect(api.listOperatorKeys).toHaveBeenCalledTimes(2)) // the list is reloaded
    })

    it('sends the last day it works as the end of that day', async () => {
      const { api, user } = setup([])
      await open(user)

      await user.type(screen.getByLabelText(/^name/i), 'temp')
      await user.type(screen.getByLabelText(/expires/i), '2099-06-30')
      await user.click(screen.getByRole('button', { name: 'Create key' }))

      await waitFor(() => expect(api.createOperatorKey).toHaveBeenCalled())
      const sent = api.createOperatorKey.mock.calls[0]![0] as { name: string; expiresAt: string }
      expect(sent.expiresAt).toBe(new Date('2099-06-30T23:59:59').toISOString())
    })

    it('cannot be created without a name', async () => {
      const { user } = setup([])
      await open(user)

      expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled()
    })

    it("shows the server's reason and keeps the form when creating fails", async () => {
      const { api, user } = setup([])
      api.createOperatorKey.mockRejectedValue(new ApiError(400, '"expiresAt" must be in the future', 'VALIDATION_ERROR'))
      await open(user)
      await user.type(screen.getByLabelText(/^name/i), 'temp')

      await user.click(screen.getByRole('button', { name: 'Create key' }))

      expect(await screen.findByText(/must be in the future/)).toBeInTheDocument()
      expect(screen.getByLabelText(/^name/i)).toHaveValue('temp')
      expect(screen.queryByTestId('new-operator-key')).not.toBeInTheDocument()
    })

    it('cannot be dismissed while the key is being created, so the secret is never lost', async () => {
      const { api, user } = setup([])
      let finish: (value: { key: OperatorKey; plaintext: string }) => void = () => undefined
      api.createOperatorKey.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
      await open(user)
      await user.type(screen.getByLabelText(/^name/i), 'temp')

      await user.click(screen.getByRole('button', { name: 'Create key' }))
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      await user.keyboard('{Escape}')
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      finish({ key: makeOperatorKey(), plaintext: 'nxop_late' })
      expect(await screen.findByTestId('new-operator-key')).toHaveTextContent('nxop_late')
    })
  })

  describe('revoking', () => {
    it('asks first, then revokes and reloads', async () => {
      const { api, user } = setup()
      await screen.findByText('provisioning script')

      await user.click(screen.getByRole('button', { name: 'Revoke operator key provisioning script' }))
      expect(api.revokeOperatorKey).not.toHaveBeenCalled()
      expect(screen.getByText(/is refused straight away/i)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Revoke key' }))

      await waitFor(() => expect(api.revokeOperatorKey).toHaveBeenCalledWith('a'))
      await waitFor(() => expect(api.listOperatorKeys).toHaveBeenCalledTimes(2))
    })

    it('does nothing when you back out', async () => {
      const { api, user } = setup()
      await screen.findByText('provisioning script')

      await user.click(screen.getByRole('button', { name: 'Revoke operator key provisioning script' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(api.revokeOperatorKey).not.toHaveBeenCalled()
    })
  })
})
