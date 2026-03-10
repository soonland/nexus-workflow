import { describe, it, expect } from 'vitest'
import { normalizeVariables, unwrapVariables } from './engineHelpers.js'

// ─── normalizeVariables ───────────────────────────────────────────────────────

describe('normalizeVariables', () => {
  it('should wrap a raw string as { type: "string", value }', () => {
    const result = normalizeVariables({ greeting: 'hello' })
    expect(result['greeting']).toEqual({ type: 'string', value: 'hello' })
  })

  it('should wrap a raw number as { type: "number", value }', () => {
    const result = normalizeVariables({ count: 42 })
    expect(result['count']).toEqual({ type: 'number', value: 42 })
  })

  it('should wrap a raw boolean as { type: "boolean", value }', () => {
    const result = normalizeVariables({ active: true })
    expect(result['active']).toEqual({ type: 'boolean', value: true })
  })

  it('should wrap null as { type: "null", value: null }', () => {
    const result = normalizeVariables({ nothing: null })
    expect(result['nothing']).toEqual({ type: 'null', value: null })
  })

  it('should wrap a raw array as { type: "array", value }', () => {
    const arr = [1, 2, 3]
    const result = normalizeVariables({ items: arr })
    expect(result['items']).toEqual({ type: 'array', value: arr })
  })

  it('should wrap a raw plain object as { type: "object", value }', () => {
    const obj = { a: 1, b: 'two' }
    const result = normalizeVariables({ data: obj })
    expect(result['data']).toEqual({ type: 'object', value: obj })
  })

  it('should pass through an already-wrapped VariableValue unchanged', () => {
    const wrapped = { type: 'string', value: 'x' }
    const result = normalizeVariables({ myVar: wrapped })
    expect(result['myVar']).toEqual({ type: 'string', value: 'x' })
  })

  it('should normalise multiple keys at once correctly', () => {
    const result = normalizeVariables({
      name: 'Alice',
      age: 30,
      active: false,
      score: null,
    })
    expect(result['name']).toEqual({ type: 'string', value: 'Alice' })
    expect(result['age']).toEqual({ type: 'number', value: 30 })
    expect(result['active']).toEqual({ type: 'boolean', value: false })
    expect(result['score']).toEqual({ type: 'null', value: null })
  })
})

// ─── unwrapVariables ──────────────────────────────────────────────────────────

describe('unwrapVariables', () => {
  it('should unwrap a number VariableValue to its raw value', () => {
    const result = unwrapVariables({ x: { type: 'number', value: 42 } })
    expect(result).toEqual({ x: 42 })
  })

  it('should unwrap multiple VariableValues to raw values', () => {
    const result = unwrapVariables({
      a: { type: 'string', value: 'hi' },
      b: { type: 'boolean', value: false },
    })
    expect(result).toEqual({ a: 'hi', b: false })
  })

  it('should return an empty object for empty input', () => {
    expect(unwrapVariables({})).toEqual({})
  })

  it('should unwrap null VariableValue to null', () => {
    const result = unwrapVariables({ nothing: { type: 'null', value: null } })
    expect(result['nothing']).toBeNull()
  })
})

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe('normalizeVariables → unwrapVariables round-trip', () => {
  it('should recover the original string value', () => {
    const original = { greeting: 'hello' }
    expect(unwrapVariables(normalizeVariables(original))).toEqual(original)
  })

  it('should recover the original number value', () => {
    const original = { count: 99 }
    expect(unwrapVariables(normalizeVariables(original))).toEqual(original)
  })

  it('should recover the original boolean value', () => {
    const original = { flag: true }
    expect(unwrapVariables(normalizeVariables(original))).toEqual(original)
  })

  it('should recover the original null value', () => {
    const original = { nothing: null }
    expect(unwrapVariables(normalizeVariables(original))).toEqual(original)
  })
})
