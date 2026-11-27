import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { html } from 'hono/html'
import type { ApprovalRequest, Approvals } from './workflow.js'

const LABELS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', stopped: 'Stopped' }

function row(request: ApprovalRequest) {
  return html`<tr>
    <td>${request.title}</td>
    <td>${request.requester}</td>
    <td>${request.amount}</td>
    <td>${LABELS[request.status]}${request.comment ? html`: ${request.comment}` : ''}</td>
    <td>
      ${request.taskId
        ? html`<form method="post" action="/tasks/${request.taskId}/decide">
            <input name="decidedBy" placeholder="Your name" required />
            <input name="comment" placeholder="Comment (optional)" />
            <button name="decision" value="approved">Approve</button>
            <button name="decision" value="rejected">Reject</button>
          </form>`
        : ''}
    </td>
  </tr>`
}

function page(requests: ApprovalRequest[]) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Approval requests</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 70rem; margin: 2rem auto; padding: 0 1rem; }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #ddd; }
          input, button { padding: 0.3rem 0.5rem; }
        </style>
      </head>
      <body>
        <h1>Approval requests</h1>
        <h2>New request</h2>
        <form method="post" action="/requests">
          <input name="requester" placeholder="Your name" required />
          <input name="title" placeholder="What do you need?" required />
          <input name="amount" type="number" min="0" step="0.01" placeholder="Amount" required />
          <button>Submit</button>
        </form>
        <h2>Requests</h2>
        ${requests.length === 0
          ? html`<p>No requests yet.</p>`
          : html`<table>
              <tr><th>Request</th><th>By</th><th>Amount</th><th>Status</th><th>Decision</th></tr>
              ${requests.map(row)}
            </table>`}
      </body>
    </html>`
}

export function createWebApp(approvals: Approvals) {
  const app = new Hono()
  // There is no login here, but another web page must still not be able to post these forms
  app.use(csrf())

  app.onError((error, c) => {
    // The CSRF refusal carries its own response
    if ('getResponse' in error) return error.getResponse()
    return c.text(`Something went wrong: ${error.message}`, 502)
  })

  app.get('/', async (c) => c.html(page(await approvals.list())))

  app.post('/requests', async (c) => {
    const form = await c.req.parseBody()
    const requester = String(form['requester'] ?? '').trim()
    const title = String(form['title'] ?? '').trim()
    const rawAmount = String(form['amount'] ?? '').trim()
    const amount = Number(rawAmount)
    if (!requester || !title || !rawAmount || !Number.isFinite(amount) || amount < 0) {
      return c.text('A name, a title and a positive amount are required.', 400)
    }
    await approvals.submit({ requester, title, amount })
    return c.redirect('/', 303)
  })

  app.post('/tasks/:id/decide', async (c) => {
    const form = await c.req.parseBody()
    const decision = form['decision']
    const decidedBy = String(form['decidedBy'] ?? '').trim()
    const comment = String(form['comment'] ?? '').trim()
    if ((decision !== 'approved' && decision !== 'rejected') || !decidedBy) {
      return c.text('A name and a decision are required.', 400)
    }
    await approvals.decide(c.req.param('id'), { decision, decidedBy, comment })
    return c.redirect('/', 303)
  })

  return app
}
