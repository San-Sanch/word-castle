export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function addDays(iso: string, n: number): string {
  const t = new Date(toUTC(iso) + n * 86400000)
  return t.toISOString().slice(0, 10)
}

export function diffDays(fromISO: string, toISO: string): number {
  return Math.round((toUTC(toISO) - toUTC(fromISO)) / 86400000)
}

/** Full days with no activity between the last active date and today (yesterday-active = 0). */
export function missedFullDays(lastActiveISO: string, todayIso: string): number {
  return Math.max(0, diffDays(lastActiveISO, todayIso) - 1)
}

/** Consecutive days with answered cards, ending today or yesterday. */
export function computeStreak(
  logs: Array<{ date: string; cardsAnswered: number }>,
  todayIso: string,
): number {
  const active = new Set(logs.filter((l) => l.cardsAnswered > 0).map((l) => l.date))
  let cursor = active.has(todayIso) ? todayIso : addDays(todayIso, -1)
  let streak = 0
  while (active.has(cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}
