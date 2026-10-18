import { describe, it, expect } from 'vitest'
import type { DefinitionDetail } from './api/types'
import { buildStartTemplate, startInputsOf } from './startTemplate'

const definition = (overrides: Partial<DefinitionDetail> = {}): DefinitionDetail => ({
  id: 'd',
  version: 1,
  startEventId: 's',
  elements: [
    { id: 'other', type: 'userTask', inputs: [{ name: 'ignored' }] },
    { id: 's', type: 'startEvent', inputs: [{ name: 'title' }, { name: 'amount', type: 'number' }] },
  ],
  ...overrides,
})

describe('startInputsOf', () => {
  it("returns the start event's inputs", () => {
    expect(startInputsOf(definition())).toEqual([{ name: 'title' }, { name: 'amount', type: 'number' }])
  })

  it('returns nothing when startEventId matches no element', () => {
    expect(startInputsOf(definition({ startEventId: 'missing' }))).toEqual([])
  })

  it('returns nothing when the start event declares no inputs', () => {
    expect(startInputsOf(definition({ elements: [{ id: 's', type: 'startEvent' }] }))).toEqual([])
  })
})

describe('buildStartTemplate', () => {
  it('fills a placeholder per type, in declared order', () => {
    const out = buildStartTemplate([{ name: 'title', type: 'string' }, { name: 'amount', type: 'number' }, { name: 'urgent', type: 'boolean' }])
    expect(out).toBe('{\n  "title": "",\n  "amount": 0,\n  "urgent": false\n}')
  })

  it('treats a missing type as string', () => {
    expect(JSON.parse(buildStartTemplate([{ name: 'title' }]))).toEqual({ title: '' })
  })

  it('returns an empty string for no inputs', () => {
    expect(buildStartTemplate([])).toBe('')
  })

  it('keeps __proto__ as an own key', () => {
    const out = buildStartTemplate([{ name: '__proto__' }, { name: 'constructor' }])
    expect(Object.keys(JSON.parse(out))).toEqual(['__proto__', 'constructor'])
  })
})
