/**
 * Editorial Approval — Scenario Tests
 *
 * These tests run realistic multi-step journeys through the editorial-approval
 * BPMN process end-to-end, using only the public engine API.
 * They serve as living documentation: if a scenario breaks, the process
 * semantics have changed in a way that needs explanation.
 *
 * Process summary:
 *   Start → Assign to Editor (service) → Editor Review (user)
 *     [boundary timer: non-interrupting → Send Reminder (service) → end_reminder]
 *   → XOR Decision
 *     [approved] → Send Notification (service)
 *       [error boundary NOTIFY_FAILED] → Log Failure (service) → Published
 *       → Published
 *     [default]  → Rejected
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execute } from '../../src/engine/ExecutionEngine.js'
import { parseBpmn } from '../../src/parser/BpmnXmlParser.js'
import type { EngineState } from '../../src/engine/ExecutionEngine.js'

// ─── Setup ────────────────────────────────────────────────────────────────────

const xml = readFileSync(
  join(import.meta.dirname, '../fixtures/bpmn/editorial-approval.bpmn'),
  'utf-8',
)
const { definition: def, errors } = parseBpmn(xml)
if (errors.length > 0) throw new Error(`Fixture has errors: ${JSON.stringify(errors)}`)
const definition = def!

let idCounter = 0
const opts = { generateId: () => `id-${++idCounter}` }

/** Helper: variable in the engine's internal format */
const str = (value: string) => ({ type: 'string' as const, value })

/** Start a fresh process instance */
function startProcess(): EngineState {
  idCounter = 0
  return execute(definition, { type: 'StartProcess' }, null, opts).newState
}

/** Find the single waiting task token at a given element */
function waitingAt(state: EngineState, elementId: string) {
  return state.tokens.find(t => t.elementId === elementId && t.status === 'waiting')
}

// ─── Scenario 1: Happy path ───────────────────────────────────────────────────

describe('Scenario: happy path — article approved and notification sent', () => {
  it('runs the complete happy path from submission to published', () => {
    // Step 1: Writer submits article — process starts, assignment task fires immediately
    let state = startProcess()
    expect(state.instance.status).toBe('active')

    const assignToken = waitingAt(state, 'task_assign')
    expect(assignToken).toBeDefined()

    // Step 2: Assignment system completes — editor is assigned
    ;({ newState: state } = execute(
      definition,
      { type: 'CompleteServiceTask', tokenId: assignToken!.id, outputVariables: { editorId: str('editor-42') } },
      state, opts,
    ))

    // Review task is now waiting for the editor
    const reviewToken = waitingAt(state, 'task_review')
    expect(reviewToken).toBeDefined()

    // Step 3: Editor approves the article
    ;({ newState: state } = execute(
      definition,
      { type: 'CompleteUserTask', tokenId: reviewToken!.id, completedBy: 'editor-42', outputVariables: { decision: str('approved') } },
      state, opts,
    ))

    // Notification task is now waiting
    const notifyToken = waitingAt(state, 'task_notify')
    expect(notifyToken).toBeDefined()

    // Step 4: Notification service sends the email successfully
    ;({ newState: state } = execute(
      definition,
      { type: 'CompleteServiceTask', tokenId: notifyToken!.id },
      state, opts,
    ))

    // Process is complete — article is published
    expect(state.instance.status).toBe('completed')
    expect(state.tokens.find(t => t.elementId === 'end_published')?.status).toBe('completed')
  })
})

// ─── Scenario 2: Rejection path ───────────────────────────────────────────────

describe('Scenario: rejection — editor rejects the article', () => {
  it('routes to the rejected end event when editor decides to reject', () => {
    let state = startProcess()

    // Assignment completes
    const assignToken = waitingAt(state, 'task_assign')!
    ;({ newState: state } = execute(definition, { type: 'CompleteServiceTask', tokenId: assignToken.id }, state, opts))

    // Editor rejects (decision defaults to 'rejected' via XOR default flow)
    const reviewToken = waitingAt(state, 'task_review')!
    ;({ newState: state } = execute(
      definition,
      { type: 'CompleteUserTask', tokenId: reviewToken.id, completedBy: 'editor-42', outputVariables: { decision: str('rejected') } },
      state, opts,
    ))

    expect(state.instance.status).toBe('completed')
    expect(state.tokens.find(t => t.elementId === 'end_rejected')?.status).toBe('completed')
    // Notification was never triggered
    expect(state.tokens.some(t => t.elementId === 'task_notify')).toBe(false)
  })
})

// ─── Scenario 3: Notification failure — graceful recovery ─────────────────────

describe('Scenario: notification failure — error boundary catches it, article still published', () => {
  it('routes through the error boundary when SendGrid is down', () => {
    let state = startProcess()

    // Assignment and review (approved)
    const assignToken = waitingAt(state, 'task_assign')!
    ;({ newState: state } = execute(definition, { type: 'CompleteServiceTask', tokenId: assignToken.id }, state, opts))
    const reviewToken = waitingAt(state, 'task_review')!
    ;({ newState: state } = execute(
      definition,
      { type: 'CompleteUserTask', tokenId: reviewToken.id, completedBy: 'editor-42', outputVariables: { decision: str('approved') } },
      state, opts,
    ))

    // Notification fails — SendGrid is down
    const notifyToken = waitingAt(state, 'task_notify')!
    ;({ newState: state } = execute(
      definition,
      { type: 'FailServiceTask', tokenId: notifyToken.id, error: { code: 'NOTIFY_FAILED', message: 'SendGrid unavailable' } },
      state, opts,
    ))

    // Process is still active — error boundary caught it, not a fatal failure
    expect(state.instance.status).toBe('active')

    // Failure logging task is now running
    const logToken = waitingAt(state, 'task_log')
    expect(logToken).toBeDefined()

    // Log task completes
    ;({ newState: state } = execute(
      definition,
      { type: 'CompleteServiceTask', tokenId: logToken!.id },
      state, opts,
    ))

    // Article is still published — notification failure didn't block the workflow
    expect(state.instance.status).toBe('completed')
    expect(state.tokens.find(t => t.elementId === 'end_published')?.status).toBe('completed')
  })
})

// ─── Scenario 4: Reminder boundary — editor is slow ──────────────────────────

describe('Scenario: reminder boundary — editor does not respond within 48h', () => {
  it('sends a reminder without cancelling the review task, review eventually completes', () => {
    let state = startProcess()

    // Assignment completes
    const assignToken = waitingAt(state, 'task_assign')!
    ;({ newState: state } = execute(definition, { type: 'CompleteServiceTask', tokenId: assignToken.id }, state, opts))

    // 48h pass — reminder boundary timer fires (non-interrupting)
    const reminderBoundaryToken = waitingAt(state, 'boundary_reminder')!
    ;({ newState: state } = execute(definition, { type: 'FireTimer', tokenId: reminderBoundaryToken.id }, state, opts))

    // Review task is STILL waiting — non-interrupting boundary left it alive
    expect(waitingAt(state, 'task_review')).toBeDefined()

    // Reminder service task is now running
    const reminderToken = waitingAt(state, 'task_reminder')!
    ;({ newState: state } = execute(definition, { type: 'CompleteServiceTask', tokenId: reminderToken.id }, state, opts))

    // Instance is still active — editor hasn't reviewed yet
    expect(state.instance.status).toBe('active')

    // Editor finally approves (better late than never)
    const reviewToken = waitingAt(state, 'task_review')!
    ;({ newState: state } = execute(
      definition,
      { type: 'CompleteUserTask', tokenId: reviewToken.id, completedBy: 'editor-42', outputVariables: { decision: str('approved') } },
      state, opts,
    ))

    // Notification and published
    const notifyToken = waitingAt(state, 'task_notify')!
    ;({ newState: state } = execute(definition, { type: 'CompleteServiceTask', tokenId: notifyToken.id }, state, opts))

    expect(state.instance.status).toBe('completed')
  })
})

// ─── Scenario 5: Admin intervention — unexpected failure ─────────────────────

describe('Scenario: admin intervention — unexpected task failure, admin skips the step', () => {
  it('suspends on unrecognised error code, admin force-completes the task', () => {
    let state = startProcess()

    // Assignment and review (approved)
    const assignToken = waitingAt(state, 'task_assign')!
    ;({ newState: state } = execute(definition, { type: 'CompleteServiceTask', tokenId: assignToken.id }, state, opts))
    const reviewToken = waitingAt(state, 'task_review')!
    ;({ newState: state } = execute(
      definition,
      { type: 'CompleteUserTask', tokenId: reviewToken.id, completedBy: 'editor-42', outputVariables: { decision: str('approved') } },
      state, opts,
    ))

    // Notification fails with an unexpected error — no boundary matches this code
    const notifyToken = waitingAt(state, 'task_notify')!
    ;({ newState: state } = execute(
      definition,
      { type: 'FailServiceTask', tokenId: notifyToken.id, error: { code: 'INFRA_OUTAGE', message: 'Entire mail cluster is down' } },
      state, opts,
    ))

    // Instance suspended — waiting for admin
    expect(state.instance.status).toBe('suspended')
    expect(state.instance.errorInfo?.code).toBe('INFRA_OUTAGE')

    // Admin investigates, decides to skip the notification step
    ;({ newState: state } = execute(
      definition,
      { type: 'CompleteServiceTask', tokenId: notifyToken.id, outputVariables: { notification_skipped: { type: 'boolean', value: true } } },
      state, opts,
    ))

    // Instance auto-resumed by the force-complete, article is published
    expect(state.instance.status).toBe('completed')
    expect(state.tokens.find(t => t.elementId === 'end_published')?.status).toBe('completed')
  })

  it('admin can also cancel the entire instance if the situation is unrecoverable', () => {
    let state = startProcess()

    const assignToken = waitingAt(state, 'task_assign')!
    ;({ newState: state } = execute(definition, { type: 'CompleteServiceTask', tokenId: assignToken.id }, state, opts))
    const reviewToken = waitingAt(state, 'task_review')!
    ;({ newState: state } = execute(
      definition,
      { type: 'CompleteUserTask', tokenId: reviewToken.id, completedBy: 'editor-42', outputVariables: { decision: str('approved') } },
      state, opts,
    ))

    const notifyToken = waitingAt(state, 'task_notify')!
    ;({ newState: state } = execute(
      definition,
      { type: 'FailServiceTask', tokenId: notifyToken.id, error: { code: 'INFRA_OUTAGE', message: 'Unrecoverable' } },
      state, opts,
    ))

    // Admin decides to cancel the whole approval — writer will need to resubmit
    ;({ newState: state } = execute(definition, { type: 'CancelInstance' }, state, opts))

    expect(state.instance.status).toBe('terminated')
    expect(state.tokens.every(t => t.status === 'cancelled' || t.status === 'completed')).toBe(true)
  })
})
