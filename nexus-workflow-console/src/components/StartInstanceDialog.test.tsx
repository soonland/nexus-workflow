import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import type { DefinitionDetail } from '../api/types'
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

  it('cannot be dismissed while the instance is starting, so onStarted is never orphaned', async () => {
    const { api, user, onClose, onStarted } = setup()
    let finish: (value: string) => void = () => undefined
    api.startInstance.mockImplementation(() => new Promise<string>((resolve) => (finish = resolve)))

    await user.click(start())

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    finish('abc')
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('abc', expect.objectContaining({ id: 'approval' })))
    expect(onClose).not.toHaveBeenCalled()
  })

  describe('declared start inputs', () => {
    const detail = (inputs?: DefinitionDetail['elements'][number]['inputs'], id = 'approval'): DefinitionDetail => ({
      id,
      version: 1,
      startEventId: 'start',
      elements: [{ id: 'start', type: 'startEvent', ...(inputs ? { inputs } : {}) }],
    })
    const variables = () => screen.getByLabelText(/variables/i)

    it('pre-fills the template and lists the hints', async () => {
      const api = makeFakeTenantApi()
      api.getDefinition.mockResolvedValue(detail([{ name: 'title', hint: 'What is being requested' }, { name: 'amount', type: 'number' }]))
      render(<StartInstanceDialog definition={makeDefinition()} api={api} onClose={vi.fn()} onStarted={vi.fn()} />)

      await waitFor(() => expect(variables()).toHaveValue('{\n  "title": "",\n  "amount": 0\n}'))
      expect(screen.getByText('title: What is being requested')).toBeInTheDocument()
      expect(screen.getByText('amount')).toBeInTheDocument()
      expect(screen.queryByText(/e\.g\. \{"amount": 120\}/)).not.toBeInTheDocument()
    })

    it("keeps today's behaviour without inputs", async () => {
      const api = makeFakeTenantApi()
      api.getDefinition.mockResolvedValue(detail())
      render(<StartInstanceDialog definition={makeDefinition()} api={api} onClose={vi.fn()} onStarted={vi.fn()} />)

      await waitFor(() => expect(api.getDefinition).toHaveBeenCalledWith('approval'))
      expect(variables()).toHaveValue('')
      expect(screen.getByText(/e\.g\. \{"amount": 120\}/)).toBeInTheDocument()
    })

    it("keeps today's behaviour when the fetch fails", async () => {
      const api = makeFakeTenantApi()
      api.getDefinition.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'))
      render(<StartInstanceDialog definition={makeDefinition()} api={api} onClose={vi.fn()} onStarted={vi.fn()} />)

      await waitFor(() => expect(api.getDefinition).toHaveBeenCalled())
      expect(variables()).toHaveValue('')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('does not overwrite what the person already typed', async () => {
      const api = makeFakeTenantApi()
      let finish: (value: DefinitionDetail) => void = () => undefined
      api.getDefinition.mockImplementation(() => new Promise<DefinitionDetail>((resolve) => (finish = resolve)))
      const user = userEvent.setup()
      render(<StartInstanceDialog definition={makeDefinition()} api={api} onClose={vi.fn()} onStarted={vi.fn()} />)

      await user.click(variables())
      await user.paste('{"mine": 1}')
      finish(detail([{ name: 'title' }]))

      await waitFor(() => expect(screen.getByText('title')).toBeInTheDocument())
      expect(variables()).toHaveValue('{"mine": 1}')
    })

    it('ignores a late response for another definition', async () => {
      const api = makeFakeTenantApi()
      const finishers: Record<string, (value: DefinitionDetail) => void> = {}
      api.getDefinition.mockImplementation((id: string) => new Promise<DefinitionDetail>((resolve) => (finishers[id] = resolve)))
      const props = { api, onClose: vi.fn(), onStarted: vi.fn() }
      const { rerender } = render(<StartInstanceDialog definition={makeDefinition({ id: 'a' })} {...props} />)
      rerender(<StartInstanceDialog definition={makeDefinition({ id: 'b' })} {...props} />)

      finishers['b']!(detail([{ name: 'fromB' }], 'b'))
      await waitFor(() => expect(variables()).toHaveValue('{\n  "fromB": ""\n}'))
      finishers['a']!(detail([{ name: 'fromA' }], 'a'))

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(variables()).toHaveValue('{\n  "fromB": ""\n}')
      expect(screen.queryByText('fromA')).not.toBeInTheDocument()
    })

    it('renders hints as plain text', async () => {
      const api = makeFakeTenantApi()
      api.getDefinition.mockResolvedValue(detail([{ name: 'title', hint: '<b>x</b>' }]))
      render(<StartInstanceDialog definition={makeDefinition()} api={api} onClose={vi.fn()} onStarted={vi.fn()} />)

      expect(await screen.findByText('title: <b>x</b>')).toBeInTheDocument()
    })
  })
})
