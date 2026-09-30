import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Sets `NAME="value"` in the text of a dotenv file: replaces the existing assignment in place,
 * or appends one. Commented-out lines and variables that merely share a prefix are left alone.
 */
export function upsertEnvVar(content: string, name: string, value: string): string {
  const line = `${name}="${value}"`
  const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n')
  const index = lines.findIndex(l => l.startsWith(`${name}=`))
  if (index === -1) lines.push(line)
  else lines[index] = line
  return lines.join('\n') + '\n'
}

/**
 * Sets `NAME="value"` in a dotenv file on disk, creating it if needed. The file is made
 * owner-read/write only (0600) — it now holds a credential — including when it already existed
 * with looser permissions.
 */
export function writeEnvVarToFile(path: string, name: string, value: string): void {
  const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
  // `mode` only applies when the file is created, so also chmod for the existing-file case.
  writeFileSync(path, upsertEnvVar(before, name, value), { mode: 0o600 })
  chmodSync(path, 0o600)
}
