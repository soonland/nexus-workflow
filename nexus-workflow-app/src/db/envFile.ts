import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

/** Valid dotenv variable name: letters, digits and underscores, not starting with a digit. */
export function isValidEnvVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

/**
 * Sets `NAME="value"` in the text of a dotenv file: replaces the existing assignment in place,
 * or appends one. Commented-out lines and variables that merely share a prefix are left alone.
 * Throws if the name is not a valid variable name (it would corrupt the file).
 */
export function upsertEnvVar(content: string, name: string, value: string): string {
  if (!isValidEnvVarName(name)) throw new Error(`Invalid environment variable name: ${JSON.stringify(name)}`)
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
  const exists = existsSync(path)
  const before = exists ? readFileSync(path, 'utf8') : ''
  const after = upsertEnvVar(before, name, value)
  // Tighten an existing file *before* the secret goes into it (`mode` below only applies when
  // the file is created), so it is never sitting in a group/world-readable file.
  if (exists) chmodSync(path, 0o600)
  writeFileSync(path, after, { mode: 0o600 })
}
