import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import type { HistoryEntry, InstanceView } from '../api/types'
import { makeFakeTenantApi, makeInstance } from '../test/fakeApi'
import { InstanceDetailPage } from './InstanceDetailPage'

// The real diagram needs a browser's SVG layout; here it is a stand-in that shows what it was told
vi.mock('../components/BpmnDiagram', () => ({
  default: (props: { xml: string; activeIds: string[]; doneIds: string[]; errorIds: string[]; onError(message: string): void }) => (
    <div data-testid="diagram">
      <span>{props.xml}</span>
      <span data-testid="active">{props.activeIds.join(',')}</span>
      <span data-testid="done">{props.doneIds.join(',')}</span>
      <span data-testid="failed">{props.errorIds.join(',')}</span>
      <button onClick={() => props.onError('bad xml')}>break the diagram</button>
    </div>
  ),
}))

const view = (overrides: Partial<InstanceView> = {}): InstanceView => ({
  instance: makeInstance({ id: 'aaaaaaaa-1111', status: 'active', businessKey: 'order-17' }),
  tokens: [{ id: 'tk1', elementId: 'review', elementType: 'userTask', status: 'active' }],
  variables: { amount: 120, customer: { name: 'Ada' } },
  ...overrides,
})

const entries: HistoryEntry[] = [
  { id: 'h1', elementId: 'start', elementType: 'startEvent', status: 'completed', startedAt: '2026-01-04T00:00:00.000Z', completedAt: '2026-01-04T00:00:00.050Z' },
  { id: 'h2', elementId: 'check', elementType: 'serviceTask', status: 'completed', startedAt: '2026-01-04T00:00:01.000Z', completedAt: '2026-01-04T00:00:03.500Z' },
  { id: 'h3', elementId: 'notify', elementType: 'serviceTask', status: 'error', startedAt: '2026-01-04T00:00:04.000Z', completedAt: '2026-01-04T00:00:04.100Z' },
]

function setup(data = view(), history = entries) {
  const api = makeFakeTenantApi()
  api.getInstance.mockResolvedValue(data)
  api.getInstanceHistory.mockResolvedValue(history)
  api.getDefinitionXml.mockResolvedValue('<bpmn/>')
  const onBack = vi.fn()
  const user = userEvent.setup()
  render(<InstanceDetailPage api={api} instanceId="aaaaaaaa-1111" onBack={onBack} />)
  return { api, user, onBack }
}

describe('InstanceDetailPage', () => {
  it('shows the instance: status, business key, definition and where it is now', async () => {
    const { api } = setup()

    expect(await screen.findByText('order-17')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Instance aaaaaaaa' })).toBeInTheDocument()
    expect(screen.getByText('approval v1')).toBeInTheDocument()
    expect(screen.getAllByText('active').length).toBeGreaterThan(0) // the status chip, and the token's status
    expect(within(screen.getByText('Where it is now').parentElement!).getByText('review')).toBeInTheDocument()
    expect(api.getDefinitionXml).toHaveBeenCalledWith('approval', 1)
  })

  it('lists the variables and the timeline with how long each step took', async () => {
    setup()
    await screen.findByText('order-17')

    expect(screen.getByText('amount')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('{"name":"Ada"}')).toBeInTheDocument()
    const row = (element: string) => screen.getAllByText(element).find((node) => node.closest('tr'))!.closest('tr')!
    expect(within(row('check')).getByText('2.5 s')).toBeInTheDocument()
    expect(within(row('start')).getByText('50 ms')).toBeInTheDocument()
    expect(within(row('notify')).getByText('error')).toBeInTheDocument()
  })

  it('hands the diagram its XML and what to mark: now, passed, failed', async () => {
    setup()

    expect(await screen.findByTestId('diagram')).toHaveTextContent('<bpmn/>')
    expect(screen.getByTestId('active')).toHaveTextContent('review')
    expect(screen.getByTestId('done')).toHaveTextContent('start,check')
    expect(screen.getByTestId('failed')).toHaveTextContent('notify')
  })

  it('does not call an element "passed" while the instance is still at it', async () => {
    setup(view({ tokens: [{ id: 'tk', elementId: 'check', elementType: 'serviceTask', status: 'active' }] }))

    await screen.findByTestId('diagram')

    expect(screen.getByTestId('done')).toHaveTextContent('start')
    expect(screen.getByTestId('done')).not.toHaveTextContent('check')
  })

  it('still shows the timeline, with a notice, when there is no XML for the definition', async () => {
    const api = makeFakeTenantApi()
    api.getInstance.mockResolvedValue(view())
    api.getInstanceHistory.mockResolvedValue(entries)
    api.getDefinitionXml.mockRejectedValue(new ApiError(404, 'no stored XML', 'NOT_FOUND'))
    render(<InstanceDetailPage api={api} instanceId="aaaaaaaa-1111" onBack={() => undefined} />)

    expect(await screen.findByText(/diagram is not available/i)).toBeInTheDocument()
    expect(screen.queryByTestId('diagram')).not.toBeInTheDocument()
    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText('notify')).toBeInTheDocument()
  })

  it('swaps the diagram for a notice when it cannot be drawn, and keeps the rest', async () => {
    const { user } = setup()

    await user.click(await screen.findByRole('button', { name: 'break the diagram' }))

    expect(await screen.findByText(/could not be drawn \(bad xml\)/i)).toBeInTheDocument()
    expect(screen.queryByTestId('diagram')).not.toBeInTheDocument()
    expect(screen.getByText('Timeline')).toBeInTheDocument()
  })

  it('says so when nothing has happened yet', async () => {
    setup(view({ tokens: [], variables: {} }), [])
    await screen.findByText('order-17')

    expect(screen.getByText(/not waiting at any element/i)).toBeInTheDocument()
    expect(screen.getByText('No variables.')).toBeInTheDocument()
    expect(screen.getByText(/nothing has finished yet/i)).toBeInTheDocument()
  })

  it('shows the error and lets you retry when the instance cannot be loaded', async () => {
    const api = makeFakeTenantApi()
    api.getInstance.mockRejectedValueOnce(new ApiError(404, "Instance 'x' not found", 'NOT_FOUND')).mockResolvedValue(view())
    api.getInstanceHistory.mockResolvedValue([])
    const user = userEvent.setup()
    render(<InstanceDetailPage api={api} instanceId="aaaaaaaa-1111" onBack={() => undefined} />)

    expect(await screen.findByText("Instance 'x' not found")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('order-17')).toBeInTheDocument()
  })

  it('goes back to the list', async () => {
    const { user, onBack } = setup()
    await screen.findByText('order-17')

    await user.click(screen.getByRole('button', { name: /back to instances/i }))

    expect(onBack).toHaveBeenCalled()
  })
})
