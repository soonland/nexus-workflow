import { readFileSync } from 'node:fs'
import { execute, parseBpmn } from 'nexus-workflow-core'
import { describe, expect, it } from 'vitest'

const xml = readFileSync(new URL('../process/approval-request.bpmn', import.meta.url), 'utf8')

function decide(decision: string) {
  const { definition, errors } = parseBpmn(xml)
  expect(errors).toEqual([])
  const started = execute(definition!, { type: 'StartProcess' }, null)
  const waiting = started.newState.tokens.find((t) => t.status === 'waiting')!
  return execute(
    definition!,
    {
      type: 'CompleteUserTask',
      tokenId: waiting.id,
      completedBy: 'alex',
      outputVariables: { decision: { type: 'string', value: decision } },
    },
    started.newState,
  )
}

function reachedElements(result: ReturnType<typeof decide>) {
  return JSON.stringify(result.events)
}

describe('approval-request process', () => {
  it('ends at "approved" when the decision is approved', () => {
    const result = decide('approved')
    expect(result.newState.instance.status).toBe('completed')
    expect(reachedElements(result)).toContain('end_approved')
  })

  it('ends at "rejected" for any other decision', () => {
    const result = decide('rejected')
    expect(result.newState.instance.status).toBe('completed')
    expect(reachedElements(result)).toContain('end_rejected')
  })
})
