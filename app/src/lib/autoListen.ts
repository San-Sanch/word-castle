import type { ReviewState, Sentence, Word } from './types.js'
import { MAX_BIAS, NEUTRAL_BIAS } from './srs.js'
import { shuffle } from './exercises.js'

/** Default silence between the term and its translation ("a" in the UI). */
export const PAUSE_BASE_MS = 3000
/** Default silence after the translation before the next pair ("b" in the UI). */
export const GAP_AFTER_PAIR_MS = 2000
/** Both pauses are user-tunable within this range, in seconds. */
export const PAUSE_MIN_SEC = 1
export const PAUSE_MAX_SEC = 20

export function clampPauseSec(sec: number, fallback: number): number {
  if (!Number.isFinite(sec)) return fallback
  return Math.min(PAUSE_MAX_SEC, Math.max(PAUSE_MIN_SEC, Math.round(sec)))
}

/** Longer phrases and sentences need more time to sink in, so the chosen pause is
 * stretched for them rather than applied flat. */
export function pauseAfterMs(text: string, baseMs: number = PAUSE_BASE_MS): number {
  const long = text.trim().split(/\s+/).length >= 4 || text.length > 20
  return long ? baseMs * 1.5 : baseMs
}

/** Reading time guaranteed after the card is tapped to reveal the translation.
 * Tapping late (just before the player would move on) must not cost the read. */
export const READ_AFTER_REVEAL_MS = 3000

/**
 * How long to wait before moving to the next word: the configured gap, unless the
 * translation was revealed so recently that the reading time isn't up yet. The
 * guarantee is READ_AFTER_REVEAL_MS counted from the tap — not added to the gap —
 * so a reveal early in the pause costs nothing.
 *
 * `revealedAt` is null when this word's translation was never revealed.
 */
export function advanceDelayMs(gapMs: number, revealedAt: number | null, now: number): number {
  const owed = revealedAt === null ? 0 : revealedAt + READ_AFTER_REVEAL_MS - now
  return Math.max(gapMs, owed, 0)
}

export type ListenContent = 'words' | 'both' | 'sentences'

export interface AutoItem {
  key: string
  hebrew: string
  translation: string
  /** present for word items (enables tap-and-hold flag-for-fix) */
  wordId?: string
}

/** A freshly shuffled listening playlist. Words already in learning
 * (repetition) are mixed with brand-new, not-yet-seen words whose volume per
 * topic follows categoryBias (0 = lots of new … 4 = none). Optionally adds
 * sentences, and can be scoped to a single category. Randomized each call. */
export function buildAutoPlaylist(opts: {
  words: Word[]
  reviews: ReviewState[]
  sentences?: Sentence[]
  content?: ListenContent
  /** limit to one topic (null = all topics) */
  category?: string | null
  categoryBias?: Record<string, number>
  /** true = random order; false (default) = reviews-first, then new words in order */
  shuffle?: boolean
  /** per-word recognition difficulty (see game.ts listenRatings), absent = 0 */
  ratings?: Record<string, number>
  /** in shuffle mode, play hardest-rated first and easiest last (ties stay shuffled) */
  ratedOrder?: boolean
  rng?: () => number
}): AutoItem[] {
  const {
    words, reviews, sentences = [], content = 'words', category = null, categoryBias = {},
    shuffle: doShuffle = false, ratings = {}, ratedOrder = false, rng = Math.random,
  } = opts
  const inCat = (c: string) => category == null || c === category

  const wordItems: AutoItem[] = []
  if (content !== 'sentences') {
    const known = new Set(reviews.map((r) => r.wordId))
    let learning = words.filter((w) => known.has(w.id) && inCat(w.category))
    // ordered mode: most-overdue reviews first
    if (!doShuffle) {
      const due = new Map<string, string>()
      for (const r of reviews) {
        if (!known.has(r.wordId)) continue
        const cur = due.get(r.wordId)
        if (!cur || r.dueAt < cur) due.set(r.wordId, r.dueAt)
      }
      learning = [...learning].sort((a, b) => {
        const da = due.get(a.id) ?? '', db = due.get(b.id) ?? ''
        return da < db ? -1 : da > db ? 1 : 0
      })
    }

    // new (unheard) words: how many per topic follows that topic's bias; which
    // ones is random when shuffling, else the first in dataset order
    const newByCat = new Map<string, Word[]>()
    for (const w of words) {
      if (known.has(w.id) || !inCat(w.category)) continue
      const bias = categoryBias[w.category] ?? NEUTRAL_BIAS
      if (bias >= MAX_BIAS) continue
      if (!newByCat.has(w.category)) newByCat.set(w.category, [])
      newByCat.get(w.category)!.push(w)
    }
    const picked: Word[] = []
    for (const [cat, pool] of newByCat) {
      const bias = categoryBias[cat] ?? NEUTRAL_BIAS
      const take = Math.round((pool.length * (MAX_BIAS - bias)) / MAX_BIAS)
      picked.push(...(doShuffle ? shuffle(pool, rng) : pool).slice(0, take))
    }
    for (const w of [...learning, ...picked]) {
      wordItems.push({ key: 'w:' + w.id, hebrew: w.hebrew, translation: w.translation, wordId: w.id })
    }
  }

  let sentItems: AutoItem[] = []
  if (content !== 'words') {
    const catOf = new Map(words.map((w) => [w.id, w.category]))
    sentItems = sentences
      .filter((s) => category == null || s.matches.some((m) => catOf.get(m.wordId) === category))
      .map((s) => ({ key: 's:' + s.id, hebrew: s.hebrew, translation: s.translation }))
  }

  const all = [...wordItems, ...sentItems]
  if (!doShuffle) return all
  const shuffled = shuffle(all, rng)
  if (!ratedOrder) return shuffled
  // stable sort: hardest first, easiest last; equal ratings keep the shuffled order
  const rating = (i: AutoItem) => (i.wordId ? ratings[i.wordId] ?? 0 : 0)
  return shuffled.sort((a, b) => rating(b) - rating(a))
}
