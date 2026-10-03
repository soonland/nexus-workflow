import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import { makeFakeTenantApi } from '../test/fakeApi'
import { DeployDefinitionDialog } from './DeployDefinitionDialog'

function setup() {
  const api = makeFakeTenantApi()
  const onClose = vi.fn()
  const onDeployed = vi.fn()
  const user = userEvent.setup()
  render(<DeployDefinitionDialog open api={api} onClose={onClose} onDeployed={onDeployed} />)
  return { api, user, onClose, onDeployed }
}

const deployButton = () => screen.getByRole('button', { name: 'Deploy' })
const xmlBox = () => screen.getByLabelText('BPMN XML')

describe('DeployDefinitionDialog', () => {
  it('cannot deploy until there is something to deploy', () => {
    setup()
    expect(deployButton()).toBeDisabled()
  })

  it('deploys pasted XML and shows what was deployed', async () => {
    const { api, user } = setup()

    await user.click(xmlBox())
    await user.paste('<bpmn:definitions/>')
    await user.click(deployButton())

    await waitFor(() => expect(api.deployDefinition).toHaveBeenCalledWith('<bpmn:definitions/>'))
    expect(await screen.findByText(/as version 2/)).toBeInTheDocument()
  })

  it('reads the XML from a chosen file', async () => {
    const { api, user } = setup()
    const file = new File(['<bpmn:definitions id="from-file"/>'], 'flow.bpmn', { type: 'application/xml' })

    await user.upload(screen.getByTestId('definition-file'), file)

    expect(await screen.findByText('flow.bpmn')).toBeInTheDocument()
    expect(xmlBox()).toHaveValue('<bpmn:definitions id="from-file"/>')
    await user.click(deployButton())
    await waitFor(() => expect(api.deployDefinition).toHaveBeenCalledWith('<bpmn:definitions id="from-file"/>'))
  })

  it('lists the warnings of an accepted definition', async () => {
    const { api, user } = setup()
    api.deployDefinition.mockResolvedValue({ id: 'p', version: 1, name: 'P', validationWarnings: ['Task has no name', { message: 'Gateway has no default flow' }] })

    await user.click(xmlBox())
    await user.paste('<x/>')
    await user.click(deployButton())

    expect(await screen.findByText(/with 2 warnings/)).toBeInTheDocument()
    expect(screen.getByText('Task has no name')).toBeInTheDocument()
    expect(screen.getByText('Gateway has no default flow')).toBeInTheDocument()
  })

  it('shows the server message and each problem when the definition is refused, and keeps the XML', async () => {
    const { api, user } = setup()
    api.deployDefinition.mockRejectedValue(new ApiError(422, 'Process definition has validation errors', 'VALIDATION_FAILED', ['No start event', 'Task "x" is unreachable']))

    await user.click(xmlBox())
    await user.paste('<bad/>')
    await user.click(deployButton())

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Process definition has validation errors')).toBeInTheDocument()
    expect(within(alert).getByText('No start event')).toBeInTheDocument()
    expect(within(alert).getByText('Task "x" is unreachable')).toBeInTheDocument()
    expect(xmlBox()).toHaveValue('<bad/>')
  })

  it('refuses a definition over 1 MB without sending it', async () => {
    const { api, user } = setup()

    await user.click(xmlBox())
    await user.paste(`<a>${'x'.repeat(1024 * 1024)}</a>`)
    await user.click(deployButton())

    expect(await screen.findByText(/larger than 1 MB/i)).toBeInTheDocument()
    expect(api.deployDefinition).not.toHaveBeenCalled()
  })

  it('reports the deploy to the page only once the person has seen the result', async () => {
    const { user, onDeployed, onClose } = setup()
    await user.click(xmlBox())
    await user.paste('<x/>')
    await user.click(deployButton())
    await screen.findByText(/as version 2/)
    expect(onDeployed).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(onDeployed).toHaveBeenCalledWith(expect.objectContaining({ id: 'approval', version: 2 }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cancelling closes without deploying', async () => {
    const { api, user, onClose } = setup()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(api.deployDefinition).not.toHaveBeenCalled()
  })

  it('cannot be dismissed while the deploy is in flight, so its result is never lost', async () => {
    const { api, user, onClose, onDeployed } = setup()
    let finish: (value: unknown) => void = () => undefined
    api.deployDefinition.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    await user.click(xmlBox())
    await user.paste('<x/>')
    await user.click(deployButton())

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    finish({ id: 'approval', version: 2, name: 'Approval', validationWarnings: [] })
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    expect(onDeployed).toHaveBeenCalledOnce()
  })
})
