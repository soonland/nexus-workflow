import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import { makeDefinition, makeFakeTenantApi } from '../test/fakeApi'
import { StartInstanceDialog } from './StartInstanceDialog'

function setup() {
  const api = makeFakeTenantApi()
  const onClose = vi.fn()
  const onStarted = vi.fn()
  const definition = makeDefinition()
  const user = userEvent.setup()
  render(<StartInstanceDialog definition={definition} api={api} onClose={onClose} onStarted={onStarted} />)
  return { api, user, onClose, onStarted, definition }
}

const start = () => screen.getByRole('button', { name: 'Start instance' })

describe('StartInstanceDialog', () => {
  it('names the definition and says it starts the latest version', () => {
    setup()
    expect(screen.getByText('Start Approval')).toBeInTheDocument()
    expect(screen.getByText(/latest version/i)).toBeInTheDocument()
  })

  it('starts with nothing filled in', async () => {
    const { api, user, onStarted, definition } = setup()

    await user.click(start())

    await waitFor(() => expect(api.startInstance).toHaveBeenCalledWith('approval', {}))
    expect(onStarted).toHaveBeenCalledWith('new-instance-id', definition)
  })

  it('sends the business key and the variables', async () => {
    const { api, user } = setup()

    await user.type(screen.getByLabelText(/business key/i), '  order-17 ')
    await user.click(screen.getByLabelText(/variables/i))
    await user.paste('{"amount": 120}')
    await user.click(start())

    await waitFor(() => expect(api.startInstance).toHaveBeenCalledWith('approval', { businessKey: 'order-17', variables: { amount: 120 } }))
  })

  it('refuses variables that are not a JSON object, before sending anything', async () => {
    const { api, user } = setup()

    await user.click(screen.getByLabelText(/variables/i))
    await user.paste('[1, 2]')
    await user.click(start())

    expect(await screen.findByText(/must be a json object/i)).toBeInTheDocument()
    expect(api.startInstance).not.toHaveBeenCalled()
  })

  it('shows why the instance could not be started and keeps what was typed', async () => {
    const { api, user, onStarted } = setup()
    api.startInstance.mockRejectedValue(new ApiError(422, "Definition 'approval' is not deployable", 'NOT_DEPLOYABLE'))
    await user.type(screen.getByLabelText(/business key/i), 'order-17')

    await user.click(start())

    expect(await screen.findByText("Definition 'approval' is not deployable")).toBeInTheDocument()
    expect(screen.getByLabelText(/business key/i)).toHaveValue('order-17')
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('cancelling closes without starting', async () => {
    const { api, user, onClose } = setup()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(api.startInstance).not.toHaveBeenCalled()
  })
})
