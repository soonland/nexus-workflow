import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { upsertEnvVar, writeEnvVarToFile } from './envFile.js'

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

describe('writeEnvVarToFile', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'envfile-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const mode = (path: string) => statSync(path).mode & 0o777

  it('creates a missing file readable and writable by the owner only', () => {
    const path = join(dir, '.env.local')

    writeEnvVarToFile(path, 'KEY', 'secret')

    expect(readFileSync(path, 'utf8')).toBe('KEY="secret"\n')
    expect(mode(path)).toBe(0o600)
  })

  it('keeps existing content and tightens the permissions of an existing file', () => {
    const path = join(dir, '.env.local')
    writeFileSync(path, 'A=1\n', { mode: 0o644 })
    chmodSync(path, 0o644)

    writeEnvVarToFile(path, 'KEY', 'secret')

    expect(readFileSync(path, 'utf8')).toBe('A=1\nKEY="secret"\n')
    expect(mode(path)).toBe(0o600)
  })
})
