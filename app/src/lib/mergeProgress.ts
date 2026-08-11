import type { Exposure, ReviewState } from './types.js'
import type { MergedIds } from './dataParse.js'
import type { GameState } from './game.js'

/** Of two review states for the same word+direction, the one that represents more
 * real learning: further along the box ladder, and failing that, reviewed sooner. */
function better(a: ReviewState, b: ReviewState): ReviewState {
  if (a.box !== b.box) return a.box > b.box ? a : b
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? a : b
  // a box reached by real answers outranks an unverified passive one
  if (!!a.passive !== !!b.passive) return a.passive ? b : a
  return a.lapses <= b.lapses ? a : b
}

/**
 * Folds progress recorded against ids that `dedupeWords` has since merged away into
 * the surviving word. Without this, learning done on a duplicate card would silently
 * vanish when the duplicate stops being part of the word list.
 *
 * Returns the state unchanged (same object) when nothing needs remapping, which is
 * the normal case on every load after the first.
 */
export function remapMergedProgress(state: GameState, merged: MergedIds): GameState {
  const touches = (id: string) => merged[id] !== undefined
  const needed =
    state.reviews.some((r) => touches(r.wordId)) ||
    state.graduatedIds.some(touches) ||
    Object.keys(state.exposures).some((k) => touches(k.split('|')[0]))
  if (!needed) return state

  const to = (id: string) => merged[id] ?? id

  const byKey = new Map<string, ReviewState>()
  for (const r of state.reviews) {
    const moved = { ...r, wordId: to(r.wordId) }
    const key = `${moved.wordId}|${moved.direction}`
    const existing = byKey.get(key)
    byKey.set(key, existing ? better(existing, moved) : moved)
  }

  const exposures: Record<string, Exposure> = {}
  for (const [key, e] of Object.entries(state.exposures)) {
    const [wordId, direction] = key.split('|')
    const next = `${to(wordId)}|${direction}`
    const prev = exposures[next]
    // keep the further-along counter rather than adding them up: the exposures were
    // on two cards, and the day rule shouldn't be easier to satisfy after a merge
    exposures[next] = !prev || e.count > prev.count ? e : prev
  }

  return {
    ...state,
    reviews: [...byKey.values()],
    graduatedIds: [...new Set(state.graduatedIds.map(to))],
    exposures,
  }
}
