import type { ReviewState, Word } from './types.js'

/** Base silence between the term and its translation. */
export const PAUSE_BASE_MS = 3000
/** Silence after the translation before the next pair. */
export const GAP_AFTER_PAIR_MS = 2000

/** Longer phrases and sentences need more time to sink in. */
export function pauseAfterMs(text: string): number {
  const long = text.trim().split(/\s+/).length >= 4 || text.length > 20
  return long ? PAUSE_BASE_MS * 1.5 : PAUSE_BASE_MS
}

/** Words already in learning, one entry per word: due-for-review first
 * (most overdue leading), then upcoming reviews by nearest dueAt. */
export function buildAutoPlaylist(words: Word[], states: ReviewState[]): string[] {
  const known = new Set(words.map((w) => w.id))
  const earliest = new Map<string, string>()
  for (const s of states) {
    if (!known.has(s.wordId)) continue
    const cur = earliest.get(s.wordId)
    if (!cur || s.dueAt < cur) earliest.set(s.wordId, s.dueAt)
  }
  return [...earliest.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([wordId]) => wordId)
}
