import { describe, it, expect } from 'vitest'
import { upsertEnvVar } from './envFile.js'

describe('upsertEnvVar', () => {
  it('appends the variable when it is not present', () => {
    expect(upsertEnvVar('A=1\n', 'KEY', 'secret')).toBe('A=1\nKEY="secret"\n')
  })

  it('adds a newline before appending when the file does not end with one', () => {
    expect(upsertEnvVar('A=1', 'KEY', 'secret')).toBe('A=1\nKEY="secret"\n')
  })

  it('creates the content for an empty file', () => {
    expect(upsertEnvVar('', 'KEY', 'secret')).toBe('KEY="secret"\n')
  })

  it('replaces an existing value in place and keeps the other lines', () => {
    const before = '# comment\nA=1\nKEY="old"\nB=2\n'
    expect(upsertEnvVar(before, 'KEY', 'new')).toBe('# comment\nA=1\nKEY="new"\nB=2\n')
  })

  it('replaces an empty value', () => {
    expect(upsertEnvVar('KEY=""\n', 'KEY', 'new')).toBe('KEY="new"\n')
  })

  it('does not touch variables that merely start with the same name', () => {
    expect(upsertEnvVar('KEY_OTHER=1\n', 'KEY', 'v')).toBe('KEY_OTHER=1\nKEY="v"\n')
  })

  it('does not treat a commented-out variable as the setting', () => {
    expect(upsertEnvVar('# KEY=old\n', 'KEY', 'v')).toBe('# KEY=old\nKEY="v"\n')
  })
})
