import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import { makeDefinition, makeFakeTenantApi } from '../test/fakeApi'
import { DefinitionsPage } from './DefinitionsPage'

function setup(definitions = [makeDefinition(), makeDefinition({ id: 'onboarding', name: 'Onboarding', version: 3, isDeployable: false })]) {
  const api = makeFakeTenantApi()
  api.listDefinitions.mockResolvedValue(definitions)
  const user = userEvent.setup()
  render(<DefinitionsPage api={api} tenantId="acme" />)
  return { api, user }
}

describe('DefinitionsPage', () => {
  it('lists the definitions of the tenant with their version', async () => {
    setup()

    const row = (await screen.findByText('Onboarding')).closest('tr')!
    expect(within(row).getByText('onboarding')).toBeInTheDocument()
    expect(within(row).getByText('3')).toBeInTheDocument()
    expect(within(row).getByText('not startable')).toBeInTheDocument()
    expect(screen.getByText('Workflows deployed in acme')).toBeInTheDocument()
  })

  it('says so when nothing is deployed', async () => {
    setup([])
    expect(await screen.findByText(/no definitions deployed yet/i)).toBeInTheDocument()
  })

  it('shows a message and lets you retry when the list cannot be loaded', async () => {
    const api = makeFakeTenantApi()
    api.listDefinitions.mockRejectedValueOnce(new ApiError(0, 'Could not reach the workflow API.')).mockResolvedValue([makeDefinition()])
    const user = userEvent.setup()
    render(<DefinitionsPage api={api} tenantId="acme" />)

    expect(await screen.findByText(/could not reach/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Approval')).toBeInTheDocument()
  })

  it('deleting asks you to type the id first, then deletes and reloads', async () => {
    const { api, user } = setup()
    await screen.findByText('Approval')

    await user.click(screen.getByRole('button', { name: 'Delete all versions of approval' }))
    const confirm = screen.getByRole('button', { name: 'Delete definition' })
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText(/type "approval"/i), 'approval')
    await user.click(confirm)

    await waitFor(() => expect(api.deleteDefinition).toHaveBeenCalledWith('approval'))
    await waitFor(() => expect(api.listDefinitions).toHaveBeenCalledTimes(2))
  })

  it("shows the server's refusal when the definition still has running instances", async () => {
    const { api, user } = setup()
    api.deleteDefinition.mockRejectedValue(new ApiError(409, "Definition 'approval' has 2 pending, active, or suspended instance(s)", 'HAS_ACTIVE_INSTANCES'))
    await screen.findByText('Approval')

    await user.click(screen.getByRole('button', { name: 'Delete all versions of approval' }))
    await user.type(screen.getByLabelText(/type "approval"/i), 'approval')
    await user.click(screen.getByRole('button', { name: 'Delete definition' }))

    expect(await screen.findByText(/has 2 pending, active, or suspended/)).toBeInTheDocument()
  })

  it('offers one delete per definition, however many versions are listed', async () => {
    setup([makeDefinition({ version: 1 }), makeDefinition({ version: 2 }), makeDefinition({ id: 'onboarding', name: 'Onboarding' })])
    await screen.findAllByText('approval')

    expect(screen.getAllByRole('button', { name: /^delete all versions of/i }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Delete all versions of approval',
      'Delete all versions of onboarding',
    ])
  })

  describe('deploying and starting', () => {
    it('deploys a definition from the header and reloads the list', async () => {
      const { api, user } = setup()
      await screen.findByText('Approval')

      await user.click(screen.getByRole('button', { name: /deploy definition/i }))
      await user.click(screen.getByLabelText('BPMN XML'))
      await user.paste('<bpmn:definitions/>')
      await user.click(screen.getByRole('button', { name: 'Deploy' }))
      await user.click(await screen.findByRole('button', { name: 'Done' }))

      await waitFor(() => expect(api.deployDefinition).toHaveBeenCalledWith('<bpmn:definitions/>'))
      await waitFor(() => expect(api.listDefinitions).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('Deployed approval v2')).toBeInTheDocument()
    })

    it('starts an instance from a definition row and says which one', async () => {
      const { api, user } = setup()
      await screen.findByText('Approval')

      await user.click(screen.getByRole('button', { name: 'Start approval' }))
      await user.click(screen.getByRole('button', { name: 'Start instance' }))

      await waitFor(() => expect(api.startInstance).toHaveBeenCalledWith('approval', {}))
      expect(await screen.findByText('Started instance new-inst of approval')).toBeInTheDocument()
    })

    it('offers Start on the latest version only, and never for a definition that cannot be started', async () => {
      setup([
        makeDefinition({ id: 'approval', version: 1 }),
        makeDefinition({ id: 'approval', version: 3 }),
        makeDefinition({ id: 'approval', version: 2 }),
        makeDefinition({ id: 'library', name: 'Library', version: 1, isDeployable: false }),
      ])
      await screen.findAllByText('approval')

      const starts = screen.getAllByRole('button', { name: /^start /i })
      expect(starts).toHaveLength(1)
      expect(within(starts[0]!.closest('tr')!).getByText('3')).toBeInTheDocument() // the version 3 row
    })
  })

  describe('search and sort', () => {
    const three = [
      makeDefinition({ id: 'onboarding', name: 'Onboarding', version: 3, deployedAt: '2026-01-05T00:00:00.000Z' }),
      makeDefinition({ id: 'approval', name: 'Approval', version: 1, deployedAt: '2026-01-09T00:00:00.000Z' }),
      makeDefinition({ id: 'expenses', name: 'Expense claims', version: 12, deployedAt: '2026-01-01T00:00:00.000Z' }),
    ]
    const shown = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.querySelector('p')?.textContent)

    it('searches by name or id', async () => {
      const { user } = setup(three)
      await screen.findByText('Onboarding')

      await user.type(screen.getByRole('searchbox', { name: 'Search definitions' }), 'EXPENSE')

      expect(shown()).toEqual(['Expense claims'])
      expect(screen.getByText('Showing 1 to 1 of 1 entries (filtered from 3)')).toBeInTheDocument()
    })

    it('says so when nothing matches', async () => {
      const { user } = setup(three)
      await screen.findByText('Onboarding')

      await user.type(screen.getByRole('searchbox', { name: 'Search definitions' }), 'zzz')

      expect(screen.getByText('Nothing matches your search')).toBeInTheDocument()
    })

    it('sorts by a column, and reverses on a second click', async () => {
      const { user } = setup(three)
      await screen.findByText('Onboarding')

      await user.click(screen.getByRole('button', { name: 'Version' }))
      expect(shown()).toEqual(['Approval', 'Onboarding', 'Expense claims']) // 1, 3, 12: as numbers

      await user.click(screen.getByRole('button', { name: 'Version' }))
      expect(shown()).toEqual(['Expense claims', 'Onboarding', 'Approval'])
    })

    it('sorts by deploy date', async () => {
      const { user } = setup(three)
      await screen.findByText('Onboarding')

      await user.click(screen.getByRole('button', { name: 'Deployed' }))

      expect(shown()).toEqual(['Expense claims', 'Onboarding', 'Approval'])
    })
  })
})
