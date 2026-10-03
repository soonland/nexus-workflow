import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import type { UserTask } from '../api/types'
import { makeFakeTenantApi, makeTask } from '../test/fakeApi'
import { TasksPage } from './TasksPage'

const open = makeTask({ id: 't1', name: 'Review timesheet', candidateGroups: ['managers'] })
const claimed = makeTask({ id: 't2', name: 'Approve expense', status: 'claimed', assignee: 'bob@example.com' })
const done = makeTask({ id: 't3', name: 'Old task', status: 'completed' })

function setup(items: UserTask[] = [open, claimed, done], total = items.length) {
  const api = makeFakeTenantApi()
  api.listTasks.mockResolvedValue({ items, total, page: 0, pageSize: 20 })
  const user = userEvent.setup()
  render(<TasksPage api={api} tenantId="acme" actor="ada@example.com" />)
  return { api, user }
}

describe('TasksPage', () => {
  it('starts on the open tasks', async () => {
    const { api } = setup()
    await screen.findByText('Review timesheet')
    expect(api.listTasks).toHaveBeenCalledWith({ status: 'open', page: 0, pageSize: 20 })
  })

  it('lists tasks with who they are assigned to', async () => {
    setup()

    const row = (await screen.findByText('Review timesheet')).closest('tr')!
    expect(within(row).getByText('managers')).toBeInTheDocument()
    expect(within(row).getByText('nobody')).toBeInTheDocument()
    expect(within(screen.getByText('Approve expense').closest('tr')!).getByText('bob@example.com')).toBeInTheDocument()
  })

  it('offers only the actions that make sense for each status', async () => {
    setup()
    await screen.findByText('Review timesheet')

    const buttons = (name: string) => within(screen.getByText(name).closest('tr')!).queryAllByRole('button').map((b) => b.textContent)
    expect(buttons('Review timesheet')).toEqual(['Claim', 'Complete'])
    expect(buttons('Approve expense')).toEqual(['Release', 'Complete'])
    expect(buttons('Old task')).toEqual([])
  })

  it('claims a task as the signed-in person, and releases it', async () => {
    const { api, user } = setup()
    await screen.findByText('Review timesheet')

    await user.click(screen.getByRole('button', { name: 'Claim Review timesheet' }))
    await waitFor(() => expect(api.claimTask).toHaveBeenCalledWith('t1', 'ada@example.com'))

    await user.click(screen.getByRole('button', { name: 'Release Approve expense' }))
    await waitFor(() => expect(api.releaseTask).toHaveBeenCalledWith('t2'))
  })

  it('completes a task after confirming, recording who did it', async () => {
    const { api, user } = setup()
    await screen.findByText('Review timesheet')

    await user.click(screen.getByRole('button', { name: 'Complete Review timesheet' }))
    expect(api.completeTask).not.toHaveBeenCalled()
    expect(screen.getByText(/completed by ada@example.com/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Complete task' }))

    await waitFor(() => expect(api.completeTask).toHaveBeenCalledWith('t1', 'ada@example.com', undefined))
  })

  it('passes output variables on, and refuses ones that are not a JSON object', async () => {
    const { api, user } = setup()
    await screen.findByText('Review timesheet')
    await user.click(screen.getByRole('button', { name: 'Complete Review timesheet' }))
    const field = screen.getByLabelText(/output variables/i)

    await user.click(field)
    await user.paste('[1, 2]')
    await user.click(screen.getByRole('button', { name: 'Complete task' }))
    expect(await screen.findByText(/must be a json object/i)).toBeInTheDocument()
    expect(api.completeTask).not.toHaveBeenCalled()

    await user.clear(field)
    await user.click(field)
    await user.paste('{"approved": true}')
    await user.click(screen.getByRole('button', { name: 'Complete task' }))
    await waitFor(() => expect(api.completeTask).toHaveBeenCalledWith('t1', 'ada@example.com', { approved: true }))
  })

  it('does nothing if you back out of completing', async () => {
    const { api, user } = setup()
    await screen.findByText('Review timesheet')

    await user.click(screen.getByRole('button', { name: 'Complete Review timesheet' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.completeTask).not.toHaveBeenCalled()
  })

  it("shows the server's refusal", async () => {
    const { api, user } = setup()
    api.claimTask.mockRejectedValue(new ApiError(422, "Task 't1' is already completed", 'INVALID_STATE'))
    await screen.findByText('Review timesheet')

    await user.click(screen.getByRole('button', { name: 'Claim Review timesheet' }))

    expect(await screen.findByText("Task 't1' is already completed")).toBeInTheDocument()
  })

  it('filters by status', async () => {
    const { api, user } = setup()
    await screen.findByText('Review timesheet')

    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'All' }))

    await waitFor(() => expect(api.listTasks).toHaveBeenLastCalledWith({ page: 0, pageSize: 20 }))
  })

  it('shows a message and lets you retry when the list cannot be loaded', async () => {
    const api = makeFakeTenantApi()
    api.listTasks.mockRejectedValueOnce(new ApiError(0, 'Could not reach the workflow API.')).mockResolvedValue({ items: [open], total: 1, page: 0, pageSize: 20 })
    const user = userEvent.setup()
    render(<TasksPage api={api} tenantId="acme" actor="ada@example.com" />)

    expect(await screen.findByText(/could not reach/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Review timesheet')).toBeInTheDocument()
  })
})
