/** Reads a JSON object typed into a text box. Empty means "none" (undefined); anything else must be an object. */
export function parseJsonObject(text: string): { ok: true; value: Record<string, unknown> | undefined } | { ok: false } {
  if (text.trim() === '') return { ok: true, value: undefined }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false }
  }
}
