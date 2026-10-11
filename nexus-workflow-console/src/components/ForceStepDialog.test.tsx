import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import type { InstanceToken } from '../api/types'
import { forceChoices } from '../forceActions'
import { makeFakeTenantApi } from '../test/fakeApi'
import { ForceStepDialog } from './ForceStepDialog'

const serviceToken: InstanceToken = { id: 'tok-1', elementId: 'send', elementType: 'serviceTask', status: 'waiting', waitingFor: { type: 'external' } }
const timerToken: InstanceToken = { id: 'tok-2', elementId: 'wait', elementType: 'intermediateCatchEvent', status: 'waiting', waitingFor: { type: 'timer' } }

function setup(token = serviceToken, choiceIndex = 0) {
  const api = makeFakeTenantApi()
  const onClose = vi.fn()
  const onDone = vi.fn()
  const choice = forceChoices(token)[choiceIndex]!
  const user = userEvent.setup()
  render(<ForceStepDialog target={{ token, choice }} instanceId="inst-1" api={api} onClose={onClose} onDone={onDone} />)
  return { api, user, onClose, onDone, choice }
}

const confirm = (name: string) => screen.getByRole('button', { name })

describe('ForceStepDialog', () => {
  it('says which step and what will happen, and that the reason is kept under their name', () => {
    setup()

    expect(screen.getByText('Complete this service task by hand')).toBeInTheDocument()
    expect(screen.getByText('send')).toBeInTheDocument()
    expect(screen.getByText(/without its worker/i)).toBeInTheDocument()
    expect(screen.getByText(/audit log under your name/i)).toBeInTheDocument()
  })

  it('cannot be confirmed without a reason, or with a blank one', async () => {
    const { api, user } = setup()
    expect(confirm('Complete')).toBeDisabled()

    await user.type(screen.getByLabelText(/^reason/i), '    ')
    expect(confirm('Complete')).toBeDisabled()

    await user.type(screen.getByLabelText(/^reason/i), 'the mail server is down')
    expect(confirm('Complete')).toBeEnabled()
    expect(api.forceStep).not.toHaveBeenCalled()
  })

  it('refuses a reason over 500 characters', async () => {
    const { user } = setup()

    await user.click(screen.getByLabelText(/^reason/i))
    await user.paste('x'.repeat(501))

    expect(screen.getByText('501 / 500')).toBeInTheDocument()
    expect(confirm('Complete')).toBeDisabled()
  })

  it('sends the step, the trimmed reason and the output variables', async () => {
    const { api, user, onDone } = setup()

    await user.type(screen.getByLabelText(/^reason/i), '  sent it by hand  ')
    await user.click(screen.getByLabelText(/output variables/i))
    await user.paste('{"sent": true}')
    await user.click(confirm('Complete'))

    await waitFor(() =>
      expect(api.forceStep).toHaveBeenCalledWith('inst-1', {
        action: 'completeServiceTask',
        tokenId: 'tok-1',
        reason: 'sent it by hand',
        outputVariables: { sent: true },
      }),
    )
    expect(onDone).toHaveBeenCalledWith('forced')
  })

  it('refuses output variables that are not a JSON object, before sending anything', async () => {
    const { api, user } = setup()
    await user.type(screen.getByLabelText(/^reason/i), 'why')
    await user.click(screen.getByLabelText(/output variables/i))
    await user.paste('[1, 2]')

    await user.click(confirm('Complete'))

    expect(await screen.findByText(/must be a json object/i)).toBeInTheDocument()
    expect(api.forceStep).not.toHaveBeenCalled()
  })

  it('has no variables field for a timer, and the button says what it does', async () => {
    const { api, user } = setup(timerToken)

    expect(screen.queryByLabelText(/output variables/i)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/^reason/i), 'no need to wait')
    await user.click(confirm('Fire now'))

    await waitFor(() => expect(api.forceStep).toHaveBeenCalledWith('inst-1', { action: 'fireTimer', tokenId: 'tok-2', reason: 'no need to wait' }))
  })

  it('fails a step with a button that looks like it', async () => {
    const { api, user } = setup(serviceToken, 1)

    expect(screen.getByText('Fail this service task by hand')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^reason/i), 'gave up waiting')
    await user.click(confirm('Fail'))

    await waitFor(() => expect(api.forceStep).toHaveBeenCalledWith('inst-1', { action: 'failServiceTask', tokenId: 'tok-1', reason: 'gave up waiting' }))
  })

  it("shows the server's refusal and keeps what was typed", async () => {
    const { api, user, onDone } = setup()
    api.forceStep.mockRejectedValue(new ApiError(422, '"fireTimer" cannot be used on the step', 'WRONG_STEP_KIND'))
    await user.type(screen.getByLabelText(/^reason/i), 'because')

    await user.click(confirm('Complete'))

    expect(await screen.findByText(/cannot be used on the step/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^reason/i)).toHaveValue('because')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('says so when the instance has moved on, does nothing more, and asks the page to reload on close', async () => {
    const { api, user, onDone, onClose } = setup()
    api.forceStep.mockRejectedValue(new ApiError(409, 'That step is no longer waiting', 'STEP_NOT_CURRENT'))
    await user.type(screen.getByLabelText(/^reason/i), 'because')

    await user.click(confirm('Complete'))

    expect(await screen.findByText(/no longer waiting: the instance has moved on/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument() // nothing left to confirm
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onDone).toHaveBeenCalledWith('moved-on')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cannot be dismissed while the request is in flight, so the answer is never lost', async () => {
    const { api, user, onClose, onDone } = setup()
    let finish: () => void = () => undefined
    api.forceStep.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    await user.type(screen.getByLabelText(/^reason/i), 'because')

    await user.click(confirm('Complete'))

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('forced'))
  })

  it('cancelling closes without doing anything', async () => {
    const { api, user, onClose } = setup()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(api.forceStep).not.toHaveBeenCalled()
  })

  it('keeps its title and button while it fades out, instead of going blank', () => {
    const api = makeFakeTenantApi()
    const choice = forceChoices(serviceToken)[0]!
    const props = { instanceId: 'inst-1', api, onClose: vi.fn(), onDone: vi.fn() }
    const { rerender } = render(<ForceStepDialog target={{ token: serviceToken, choice }} {...props} />)
    expect(screen.getByText('Complete this service task by hand')).toBeInTheDocument()

    rerender(<ForceStepDialog target={null} {...props} />)

    // still in the page during the exit transition, with its text
    expect(screen.getByText('Complete this service task by hand')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument()
  })

  it('shows the new step when it is opened for another one', () => {
    const api = makeFakeTenantApi()
    const props = { instanceId: 'inst-1', api, onClose: vi.fn(), onDone: vi.fn() }
    const { rerender } = render(<ForceStepDialog target={{ token: serviceToken, choice: forceChoices(serviceToken)[0]! }} {...props} />)

    rerender(<ForceStepDialog target={{ token: timerToken, choice: forceChoices(timerToken)[0]! }} {...props} />)

    expect(screen.getByText('Fire this timer now')).toBeInTheDocument()
    expect(screen.queryByText('Complete this service task by hand')).not.toBeInTheDocument()
  })
})
