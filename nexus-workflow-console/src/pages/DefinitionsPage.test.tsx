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

    await user.click(screen.getByRole('button', { name: 'Delete approval version 1' }))
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

    await user.click(screen.getByRole('button', { name: 'Delete approval version 1' }))
    await user.type(screen.getByLabelText(/type "approval"/i), 'approval')
    await user.click(screen.getByRole('button', { name: 'Delete definition' }))

    expect(await screen.findByText(/has 2 pending, active, or suspended/)).toBeInTheDocument()
  })
})
