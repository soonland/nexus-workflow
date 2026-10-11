import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import type { HistoryEntry, InstanceEvent, InstanceView } from '../api/types'
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

const event = (id: string, type: string, data: Record<string, unknown>, at = '2026-01-04T00:00:00.000Z'): InstanceEvent => ({ id, type, occurredAt: at, data })

// start -> check -> notify (failed), and the instance is now at "review"
const events: InstanceEvent[] = [
  event('e1', 'ProcessInstanceStarted', { instanceId: 'i' }),
  event('e2', 'TokenMoved', { fromElementId: 'start', toElementId: 'check' }),
  event('e3', 'TokenMoved', { fromElementId: 'check', toElementId: 'notify' }),
  event('e4', 'ServiceTaskFailed', { elementId: 'notify', error: 'smtp down', attempt: 1 }),
  event('e5', 'TokenMoved', { fromElementId: 'notify', toElementId: 'review' }),
]

function setup(data = view(), log = events, steps: HistoryEntry[] = []) {
  const api = makeFakeTenantApi()
  api.getInstanceHistory.mockResolvedValue(steps)
  api.getInstance.mockResolvedValue(data)
  api.getInstanceEvents.mockResolvedValue(log)
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

  it('lists the variables and, as history, what happened in words', async () => {
    setup()
    await screen.findByText('order-17')

    expect(screen.getByText('amount')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('{"name":"Ada"}')).toBeInTheDocument()
    expect(screen.getByText('Instance started')).toBeInTheDocument()
    expect(screen.getByText('Moved from start to check')).toBeInTheDocument()
    expect(screen.getByText('Service task failed: smtp down')).toBeInTheDocument()
  })

  it('hands the diagram its XML and what to mark: now, passed, failed', async () => {
    setup()

    expect(await screen.findByTestId('diagram')).toHaveTextContent('<bpmn/>')
    expect(screen.getByTestId('active')).toHaveTextContent('review')
    expect(screen.getByTestId('done')).toHaveTextContent('start,check')
    expect(screen.getByTestId('failed')).toHaveTextContent('notify')
  })

  it('does not call an element "passed" while the instance is still at it', async () => {
    // the instance went back to "check" (a loop): it is there now, so it is "now", not "passed"
    setup(view({ tokens: [{ id: 'tk', elementId: 'check', elementType: 'serviceTask', status: 'active' }] }))

    await screen.findByTestId('diagram')

    expect(screen.getByTestId('done')).toHaveTextContent('start')
    expect(screen.getByTestId('done')).not.toHaveTextContent('check')
  })

  it('still shows the timeline, with a notice, when there is no XML for the definition', async () => {
    const api = makeFakeTenantApi()
    api.getInstance.mockResolvedValue(view())
    api.getInstanceEvents.mockResolvedValue(events)
    api.getDefinitionXml.mockRejectedValue(new ApiError(404, 'no stored XML', 'NOT_FOUND'))
    render(<InstanceDetailPage api={api} instanceId="aaaaaaaa-1111" onBack={() => undefined} />)

    expect(await screen.findByText(/diagram is not available/i)).toBeInTheDocument()
    expect(screen.queryByTestId('diagram')).not.toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('Instance started')).toBeInTheDocument()
  })

  it('swaps the diagram for a notice when it cannot be drawn, and keeps the rest', async () => {
    const { user } = setup()

    await user.click(await screen.findByRole('button', { name: 'break the diagram' }))

    expect(await screen.findByText(/could not be drawn \(bad xml\)/i)).toBeInTheDocument()
    expect(screen.queryByTestId('diagram')).not.toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
  })

  it('tries the diagram again on refresh after it failed to draw', async () => {
    const { api, user } = setup()
    await user.click(await screen.findByRole('button', { name: 'break the diagram' }))
    expect(await screen.findByText(/could not be drawn/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByTestId('diagram')).toBeInTheDocument()
    expect(screen.queryByText(/could not be drawn/i)).not.toBeInTheDocument()
    expect(api.getInstance).toHaveBeenCalledTimes(2)
  })

  it('says so when nothing has happened yet', async () => {
    setup(view({ tokens: [], variables: {} }), [])
    await screen.findByText('order-17')

    expect(screen.getByText(/not waiting at any element/i)).toBeInTheDocument()
    expect(screen.getByText('No variables.')).toBeInTheDocument()
    expect(screen.getByText(/nothing has been recorded yet/i)).toBeInTheDocument()
  })

  it('shows the error and lets you retry when the instance cannot be loaded', async () => {
    const api = makeFakeTenantApi()
    api.getInstance.mockRejectedValueOnce(new ApiError(404, "Instance 'x' not found", 'NOT_FOUND')).mockResolvedValue(view())
    api.getInstanceEvents.mockResolvedValue([])
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

  describe('with step history', () => {
    const step = (overrides: Partial<HistoryEntry> & Pick<HistoryEntry, 'elementId'>): HistoryEntry => ({
      id: `s-${overrides.elementId}`,
      elementType: 'serviceTask',
      status: 'completed',
      startedAt: '2026-01-04T00:00:00.000Z',
      completedAt: '2026-01-04T00:00:02.500Z',
      ...overrides,
    })
    const steps: HistoryEntry[] = [
      step({ elementId: 'start', elementType: 'startEvent', completedAt: '2026-01-04T00:00:00.000Z' }),
      step({ elementId: 'check', variablesSnapshot: { amount: { type: 'number', value: 120 } } }),
      step({ elementId: 'notify', status: 'error', startedAt: '2026-01-04T00:01:00.000Z', completedAt: '2026-01-04T00:03:05.000Z' }),
    ]
    const row = (element: string) => screen.getAllByText(element).find((node) => node.closest('tr'))!.closest('tr')!

    it('lists each step with how it went and how long it took', async () => {
      setup(view(), events, steps)
      await screen.findByText('order-17')

      expect(within(row('check')).getByText('completed')).toBeInTheDocument()
      expect(within(row('check')).getByText('2.5 s')).toBeInTheDocument()
      expect(within(row('start')).getByText('0 ms')).toBeInTheDocument()
      expect(within(row('notify')).getByText('error')).toBeInTheDocument()
      expect(within(row('notify')).getByText('2 min 5 s')).toBeInTheDocument()
    })

    it('marks the diagram from the steps', async () => {
      setup(view(), events, steps)

      await screen.findByTestId('diagram')

      expect(screen.getByTestId('active')).toHaveTextContent('review')
      expect(screen.getByTestId('done')).toHaveTextContent('start,check')
      expect(screen.getByTestId('failed')).toHaveTextContent('notify')
    })

    it('shows the variables as they were at a step, on request', async () => {
      const { user } = setup(view(), events, steps)
      await screen.findByText('order-17')
      expect(screen.queryByRole('table', { name: 'Variables at check' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Show the variables at check' }))

      const table = await screen.findByRole('table', { name: 'Variables at check' })
      expect(within(table).getByText('amount')).toBeInTheDocument()
      expect(within(table).getByText('120')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Hide the variables at check' }))
      await waitFor(() => expect(screen.queryByRole('table', { name: 'Variables at check' })).not.toBeInTheDocument())
    })

    it('offers no variables button for a step that has no snapshot', async () => {
      setup(view(), events, steps)
      await screen.findByText('order-17')

      expect(screen.queryByRole('button', { name: /variables at start/i })).not.toBeInTheDocument()
    })

    it('keeps the event log available, under the steps', async () => {
      const { user } = setup(view(), events, steps)
      await screen.findByText('order-17')

      await user.click(screen.getByRole('button', { name: /event log \(5\)/i }))

      expect(await screen.findByText('Service task failed: smtp down')).toBeInTheDocument()
    })

    it('uses the event log alone for an instance that has no steps', async () => {
      setup(view(), events, [])

      expect(await screen.findByText('Service task failed: smtp down')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /event log/i })).not.toBeInTheDocument()
      expect(screen.getByTestId('done')).toHaveTextContent('start,check') // marked from the events
    })

    it('still works from the event log when the steps cannot be read', async () => {
      const api = makeFakeTenantApi()
      api.getInstance.mockResolvedValue(view())
      api.getInstanceEvents.mockResolvedValue(events)
      api.getInstanceHistory.mockRejectedValue(new ApiError(500, 'Boom', 'INTERNAL'))
      render(<InstanceDetailPage api={api} instanceId="aaaaaaaa-1111" onBack={() => undefined} />)

      expect(await screen.findByText('Service task failed: smtp down')).toBeInTheDocument()
      expect(screen.queryByText('Boom')).not.toBeInTheDocument()
    })
  })

  describe('an error the instance had', () => {
    const withError = (status: 'suspended' | 'completed') =>
      view({
        instance: {
          ...makeInstance({ id: 'aaaaaaaa-1111', status }),
          errorInfo: { code: 'HANDLER_NOT_FOUND', message: 'No handler registered', elementId: 'send' },
        },
      })

    it('says the instance is suspended by it, while it is', async () => {
      setup(withError('suspended'))

      expect(await screen.findByText(/suspended by an error: HANDLER_NOT_FOUND: No handler registered \(at send\)/i)).toBeInTheDocument()
    })

    it('is only a note once the instance has moved on, not a red error on a finished instance', async () => {
      setup(withError('completed'))

      const note = await screen.findByText(/had an error earlier: HANDLER_NOT_FOUND/i)
      expect(note.closest('[role="alert"]')).toHaveClass('MuiAlert-colorInfo')
      expect(screen.queryByText(/suspended by an error/i)).not.toBeInTheDocument()
    })
  })

  describe('pushing a stuck step along', () => {
    const stuck = (overrides: Partial<InstanceView> = {}): InstanceView =>
      view({
        tokens: [
          { id: 'tok-svc', elementId: 'send', elementType: 'serviceTask', status: 'waiting', waitingFor: { type: 'external' } },
          { id: 'tok-timer', elementId: 'wait', elementType: 'intermediateCatchEvent', status: 'waiting', waitingFor: { type: 'timer' } },
          { id: 'tok-task', elementId: 'review', elementType: 'userTask', status: 'waiting', waitingFor: { type: 'user-task' } },
        ],
        ...overrides,
      })

    it('offers each waiting step the actions that fit it', async () => {
      setup(stuck())
      await screen.findByText('order-17')

      const rowOf = (element: string) => screen.getAllByText(element).find((n) => n.closest('tr'))!.closest('tr')!
      const buttons = (element: string) => within(rowOf(element)).getAllByRole('button').map((b) => b.textContent)
      expect(buttons('send')).toEqual(['Complete', 'Fail'])
      expect(buttons('wait')).toEqual(['Fire now'])
      expect(buttons('review')).toEqual(['Complete as me'])
    })

    it('offers nothing for steps that are not waiting in a way that can be pushed', async () => {
      setup(view()) // its token is "active", not waiting
      await screen.findByText('order-17')

      expect(screen.queryByRole('button', { name: /^(Complete|Fail|Fire now)/ })).not.toBeInTheDocument()
    })

    it('asks for a reason, pushes the step along, tells the person and reloads', async () => {
      const { api, user } = setup(stuck())
      api.forceStep.mockResolvedValue(undefined)
      await screen.findByText('order-17')

      await user.click(screen.getByRole('button', { name: 'Fire now: wait' }))
      expect(await screen.findByText('Fire this timer now')).toBeInTheDocument()
      await user.type(screen.getByLabelText(/^reason/i), 'customer called')
      await user.click(screen.getByRole('button', { name: 'Fire now' }))

      await waitFor(() => expect(api.forceStep).toHaveBeenCalledWith('aaaaaaaa-1111', { action: 'fireTimer', tokenId: 'tok-timer', reason: 'customer called' }))
      expect(await screen.findByText('The step was pushed along')).toBeInTheDocument()
      await waitFor(() => expect(api.getInstance).toHaveBeenCalledTimes(2)) // reloaded
    })

    it('says nothing was changed when the instance had already moved on, and reloads', async () => {
      const { api, user } = setup(stuck())
      api.forceStep.mockRejectedValue(new ApiError(409, 'gone', 'STEP_NOT_CURRENT'))
      await screen.findByText('order-17')

      await user.click(screen.getByRole('button', { name: 'Complete: send' }))
      await user.type(await screen.findByLabelText(/^reason/i), 'stuck')
      await user.click(screen.getByRole('button', { name: 'Complete' }))
      await user.click(await screen.findByRole('button', { name: 'Close' }))

      expect(await screen.findByText(/had already moved on: nothing was changed/i)).toBeInTheDocument()
      await waitFor(() => expect(api.getInstance).toHaveBeenCalledTimes(2))
    })

    it('shows forced steps in the history, with who, what, for whom and why', async () => {
      const steps: HistoryEntry[] = [
        {
          id: 's1',
          elementId: 'review',
          elementType: 'userTask',
          status: 'completed',
          startedAt: '2026-01-04T00:00:00.000Z',
          completedAt: '2026-01-04T00:05:00.000Z',
          forced: { action: 'completeUserTask', by: 'manager@example.com', reason: 'Ada is on leave', onBehalfOf: 'ada@example.com' },
        },
        { id: 's2', elementId: 'start', elementType: 'startEvent', status: 'completed', startedAt: '2026-01-04T00:00:00.000Z', completedAt: '2026-01-04T00:00:00.000Z' },
      ]
      setup(view(), events, steps)
      await screen.findByText('order-17')

      // the "where it is now" table also has a row for "review"; the history row is the one with the marker
      const forced = screen.getByText('forced').closest('tr')!
      expect(within(forced).getByText('review')).toBeInTheDocument()
      expect(within(forced).getByText(/manager@example.com completed a task for ada@example.com: “Ada is on leave”/)).toBeInTheDocument()
      expect(screen.getAllByText('forced')).toHaveLength(1) // the step that was not forced has no marker
    })
  })
})
