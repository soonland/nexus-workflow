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
