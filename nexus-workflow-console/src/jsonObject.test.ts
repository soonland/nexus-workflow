import { describe, it, expect } from 'vitest'
import { parseJsonObject } from './jsonObject'

describe('parseJsonObject', () => {
  it('treats empty or blank text as "none"', () => {
    expect(parseJsonObject('')).toEqual({ ok: true, value: undefined })
    expect(parseJsonObject('  \n ')).toEqual({ ok: true, value: undefined })
  })

  it('accepts an object', () => {
    expect(parseJsonObject('{"amount": 120, "tags": ["a"]}')).toEqual({ ok: true, value: { amount: 120, tags: ['a'] } })
    expect(parseJsonObject('{}')).toEqual({ ok: true, value: {} })
  })

  it.each(['[1, 2]', '"text"', '42', 'null', 'true', '{broken', "{'single': 1}"])('refuses %s', (text) => {
    expect(parseJsonObject(text)).toEqual({ ok: false })
  })
})
