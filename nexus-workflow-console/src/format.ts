export function formatDate(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** How long something took: "42 ms", "3.5 s", "2 min 5 s", "1 h 4 min". Dashes for a time that makes no sense. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')} s`
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 3600) {
    const seconds = totalSeconds % 60
    return `${Math.floor(totalSeconds / 60)} min${seconds ? ` ${seconds} s` : ''}`
  }
  const minutes = Math.round((totalSeconds % 3600) / 60)
  const hours = Math.floor(totalSeconds / 3600) + (minutes === 60 ? 1 : 0)
  return `${hours} h${minutes && minutes !== 60 ? ` ${minutes} min` : ''}`
}
