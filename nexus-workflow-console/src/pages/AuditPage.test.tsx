import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import type { AuditEntry } from '../api/types'
import type { Session } from '../auth/roles'
import { makeAuditEntry, makeFakeApi, makeTenant, managerSession, operatorSession } from '../test/fakeApi'
import { AuditPage } from './AuditPage'

const operator: Session = { kind: 'user', ...operatorSession() }
const manager = (...tenants: string[]): Session => ({ kind: 'user', ...managerSession(...tenants) })

const suspend = makeAuditEntry({ id: 'e1', action: 'tenant.suspend', target: 'acme', tenantIds: ['acme'] })
const signIn = makeAuditEntry({ id: 'e2', action: 'login.success', actor: { kind: 'user', id: 'op', label: 'op@example.com' }, tenantIds: [], target: null, details: { ip: '10.0.0.1' } })
const failed = makeAuditEntry({ id: 'e3', action: 'login.failure', actor: { kind: 'anonymous', id: null, label: 'x@example.com' }, tenantIds: [], target: null, details: { reason: 'bad credentials', ip: '10.0.0.2' } })
const byKey = makeAuditEntry({ id: 'e4', action: 'key.revoke', actor: { kind: 'adminKey', id: null, label: 'admin key' }, tenantIds: ['acme', 'globex'], target: 'k1' })

function setup(session: Session, entries: AuditEntry[] = [suspend, signIn, failed, byKey], total = entries.length) {
  const api = makeFakeApi()
  api.listAudit.mockResolvedValue({ entries, total, page: 0, pageSize: 20 })
  api.listTenants.mockResolvedValue([makeTenant({ id: 'acme' }), makeTenant({ id: 'globex' })])
  const user = userEvent.setup()
  render(<AuditPage api={api} session={session} />)
  return { api, user }
}

describe('AuditPage', () => {
  it('lists what happened in words, with the code, who did it and the tenants', async () => {
    setup(operator)

    const row = (await screen.findByText('Suspended tenant acme')).closest('tr')!
    expect(within(row).getByText('tenant.suspend')).toBeInTheDocument()
    expect(within(row).getByText('op@example.com')).toBeInTheDocument()
    expect(within(row).getByText('acme')).toBeInTheDocument()
  })

  it('says who is not a signed-in person, and shows platform-wide entries as such', async () => {
    setup(operator)

    const keyRow = (await screen.findByText('Revoked an API key')).closest('tr')!
    expect(within(keyRow).getByText('admin key', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(within(keyRow).getByText('acme')).toBeInTheDocument()
    expect(within(keyRow).getByText('globex')).toBeInTheDocument()
    const failedRow = screen.getByText('Failed sign-in (bad credentials)').closest('tr')!
    expect(within(failedRow).getByText('not signed in')).toBeInTheDocument()
    expect(within(failedRow).getByText('platform')).toBeInTheDocument()
  })

  it('shows the remaining facts, such as the address of a sign-in', async () => {
    setup(operator)
    const row = (await screen.findByText('Signed in')).closest('tr')!
    expect(within(row).getByText('ip: 10.0.0.1')).toBeInTheDocument()
  })

  it('asks for the first page, newest entries, with no filters', async () => {
    const { api } = setup(operator)
    await screen.findByText('Suspended tenant acme')
    expect(api.listAudit).toHaveBeenCalledWith({ page: 0, pageSize: 20 })
  })

  it('says what is showing, and says so when there is nothing', async () => {
    setup(operator, [suspend], 45)
    expect(await screen.findByText('Showing 1 to 20 of 45 entries')).toBeInTheDocument()
  })

  it('says nothing has been recorded when the log is empty', async () => {
    setup(operator, [])
    expect(await screen.findByText('Nothing has been recorded yet')).toBeInTheDocument()
  })

  it('shows a message and lets you retry when the log cannot be loaded', async () => {
    const api = makeFakeApi()
    api.listAudit.mockRejectedValueOnce(new ApiError(0, 'Could not reach the workflow API.')).mockResolvedValue({ entries: [suspend], total: 1, page: 0, pageSize: 20 })
    api.listTenants.mockResolvedValue([])
    const user = userEvent.setup()
    render(<AuditPage api={api} session={operator} />)

    expect(await screen.findByText(/could not reach/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Suspended tenant acme')).toBeInTheDocument()
  })

  describe('filters', () => {
    it('asks the server for one tenant, from the first page', async () => {
      const { api, user } = setup(operator, [suspend], 100)
      await screen.findByText('Suspended tenant acme')
      await user.click(screen.getByRole('button', { name: /next page/i }))
      await waitFor(() => expect(api.listAudit).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 }))

      await user.click(screen.getByRole('combobox', { name: 'Tenant' }))
      await user.click(await screen.findByRole('option', { name: 'globex' }))

      await waitFor(() => expect(api.listAudit).toHaveBeenLastCalledWith({ page: 0, pageSize: 20, tenant: 'globex' }))
    })

    it('asks for a family of actions', async () => {
      const { api, user } = setup(operator)
      await screen.findByText('Suspended tenant acme')

      await user.click(screen.getByRole('combobox', { name: 'What' }))
      await user.click(await screen.findByRole('option', { name: 'API keys' }))

      await waitFor(() => expect(api.listAudit).toHaveBeenLastCalledWith({ page: 0, pageSize: 20, action: 'key' }))
    })

    it('waits for typing to settle before asking about a person', async () => {
      const { api, user } = setup(operator)
      await screen.findByText('Suspended tenant acme')
      const before = api.listAudit.mock.calls.length

      await user.type(screen.getByLabelText('Who (user id)'), 'abc')

      await waitFor(() => expect(api.listAudit).toHaveBeenLastCalledWith({ page: 0, pageSize: 20, actor: 'abc' }))
      // one request for the finished word, not one per letter
      expect(api.listAudit.mock.calls.length - before).toBeLessThanOrEqual(2)
    })

    it('sends a date range as ISO dates', async () => {
      const { api, user } = setup(operator)
      await screen.findByText('Suspended tenant acme')

      await user.type(screen.getByLabelText('From'), '2026-03-01T08:30')

      await waitFor(() => {
        const last = api.listAudit.mock.calls.at(-1)![0] as { from?: string }
        expect(last.from).toBe(new Date('2026-03-01T08:30').toISOString())
      })
    })

    it('includes the whole minute chosen as the end of the range', async () => {
      const { api, user } = setup(operator)
      await screen.findByText('Suspended tenant acme')

      await user.type(screen.getByLabelText('To'), '2026-03-01T10:30')

      await waitFor(() => {
        const last = api.listAudit.mock.calls.at(-1)![0] as { to?: string }
        // 10:30 means up to 10:30:59.999, so an entry at 10:30:20 is not left out
        expect(last.to).toBe(new Date(new Date('2026-03-01T10:30').getTime() + 59_999).toISOString())
      })
    })

    it('says nothing matches when a filter finds nothing', async () => {
      const { api, user } = setup(operator)
      await screen.findByText('Suspended tenant acme')
      api.listAudit.mockResolvedValue({ entries: [], total: 0, page: 0, pageSize: 20 })

      await user.click(screen.getByRole('combobox', { name: 'What' }))
      await user.click(await screen.findByRole('option', { name: 'Roles' }))

      expect(await screen.findByText('Nothing matches these filters')).toBeInTheDocument()
    })
  })

  it('drops an old error as soon as it steps back from a page that no longer exists', async () => {
    const api = makeFakeApi()
    api.listTenants.mockResolvedValue([])
    api.listAudit
      .mockResolvedValueOnce({ entries: [suspend], total: 45, page: 0, pageSize: 20 }) // first load
      .mockResolvedValueOnce({ entries: [suspend], total: 45, page: 1, pageSize: 20 }) // next page
      .mockRejectedValueOnce(new ApiError(500, 'Boom', 'INTERNAL')) // a failed refresh
      .mockResolvedValueOnce({ entries: [], total: 5, page: 1, pageSize: 20 }) // retry: page 1 is gone, only one page left
      .mockReturnValue(new Promise(() => undefined)) // the reload after stepping back is still in flight
    const user = userEvent.setup()
    render(<AuditPage api={api} session={operator} />)
    await screen.findByText('Suspended tenant acme')
    await user.click(screen.getByRole('button', { name: /next page/i }))
    await waitFor(() => expect(api.listAudit).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Boom')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    // the alert goes at once, not when the reload finally answers (it never does here)
    await waitFor(() => expect(screen.queryByText('Boom')).not.toBeInTheDocument())
    expect(api.listAudit).toHaveBeenLastCalledWith({ page: 0, pageSize: 20 })
  })

  describe('as a tenant manager', () => {
    it('offers only their own tenants, and does not load the full tenant list', async () => {
      const { api, user } = setup(manager('acme', 'initech'), [suspend])
      await screen.findByText('Suspended tenant acme')

      await user.click(screen.getByRole('combobox', { name: 'Tenant' }))
      const options = (await screen.findAllByRole('option')).map((o) => o.textContent)

      expect(options).toEqual(['All of mine', 'acme', 'initech'])
      expect(api.listTenants).not.toHaveBeenCalled()
    })

    it('does not offer to filter by sign-ins, which are not theirs to see', async () => {
      const { user } = setup(manager('acme'), [suspend])
      await screen.findByText('Suspended tenant acme')

      await user.click(screen.getByRole('combobox', { name: 'What' }))
      const options = (await screen.findAllByRole('option')).map((o) => o.textContent)

      expect(options).not.toContain('Sign-ins')
      expect(options).toContain('API keys')
    })

    it('says whose log it is', async () => {
      setup(manager('acme'), [suspend])
      expect(await screen.findByText(/in your tenant, newest first/i)).toBeInTheDocument()
    })
  })
})
