import { describe, expect, it, vi } from 'vitest'
import { createWebApp } from './web.js'
import type { ApprovalRequest, Approvals } from './workflow.js'

function setup(requests: ApprovalRequest[] = []) {
  const approvals: Approvals = {
    deployIfMissing: vi.fn(async () => {}),
    submit: vi.fn(async () => {}),
    list: vi.fn(async () => requests),
    decide: vi.fn(async () => {}),
  }
  return { approvals, app: createWebApp(approvals) }
}

function post(app: ReturnType<typeof createWebApp>, path: string, fields: Record<string, string>) {
  return app.request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
    body: new URLSearchParams(fields).toString(),
  })
}

describe('GET /', () => {
  it('offers a decision form for pending requests only, and escapes user text', async () => {
    const { app } = setup([
      { id: '1', requester: 'sam', title: '<script>x</script>', amount: 5, status: 'pending', taskId: 't1' },
      { id: '2', requester: 'kim', title: 'Chair', amount: 9, status: 'approved' },
    ])
    const body = await (await app.request('http://localhost/')).text()
    expect(body).toContain('/tasks/t1/decide')
    expect(body.match(/\/decide"/g)).toHaveLength(1)
    expect(body).toContain('Chair')
    expect(body).not.toContain('<script>x')
  })

  it('says what went wrong when the engine cannot be reached', async () => {
    const { app, approvals } = setup()
    vi.mocked(approvals.list).mockRejectedValue(new Error('fetch failed'))
    const res = await app.request('http://localhost/')
    expect(res.status).toBe(502)
    expect(await res.text()).toContain('fetch failed')
  })
})

describe('POST /requests', () => {
  it('submits the request and goes back to the list', async () => {
    const { app, approvals } = setup()
    const res = await post(app, '/requests', { requester: ' sam ', title: 'Laptop', amount: '1200' })
    expect(res.status).toBe(303)
    expect(approvals.submit).toHaveBeenCalledWith({ requester: 'sam', title: 'Laptop', amount: 1200 })
  })

  it.each([
    { requester: '', title: 'Laptop', amount: '1' },
    { requester: 'sam', title: ' ', amount: '1' },
    { requester: 'sam', title: 'Laptop', amount: 'abc' },
    { requester: 'sam', title: 'Laptop', amount: '' },
    { requester: 'sam', title: 'Laptop', amount: '-3' },
  ])('refuses %o', async (fields) => {
    const { app, approvals } = setup()
    expect((await post(app, '/requests', fields)).status).toBe(400)
    expect(approvals.submit).not.toHaveBeenCalled()
  })

  it('refuses a form posted from another site', async () => {
    const { app, approvals } = setup()
    const res = await app.request('http://localhost/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' },
      body: 'requester=a&title=b&amount=1',
    })
    expect(res.status).toBe(403)
    expect(approvals.submit).not.toHaveBeenCalled()
  })
})

describe('POST /tasks/:id/decide', () => {
  it('records the decision', async () => {
    const { app, approvals } = setup()
    const res = await post(app, '/tasks/t1/decide', { decision: 'rejected', decidedBy: 'alex', comment: 'too dear' })
    expect(res.status).toBe(303)
    expect(approvals.decide).toHaveBeenCalledWith('t1', { decision: 'rejected', decidedBy: 'alex', comment: 'too dear' })
  })

  it('refuses an unknown decision or a missing name', async () => {
    const { app, approvals } = setup()
    expect((await post(app, '/tasks/t1/decide', { decision: 'maybe', decidedBy: 'alex' })).status).toBe(400)
    expect((await post(app, '/tasks/t1/decide', { decision: 'approved', decidedBy: '' })).status).toBe(400)
    expect(approvals.decide).not.toHaveBeenCalled()
  })
})
