import type { Direction, Exposure, ReviewState, Word } from './types.js'
import { addDays } from './time.js'

export const INTERVALS_DAYS = [0, 1, 2, 4, 8, 16, 32, 64]
export const MAX_BOX = INTERVALS_DAYS.length - 1

/** Recognition box at which the recall direction unlocks. */
export const RECALL_UNLOCK_BOX = 2
/** Recall box at which a word graduates (pays bonus, becomes a brick). */
export const GRADUATION_BOX = 3

/** categoryBias scale: 0 = most new words … 4 = none (repeat only). */
export const NEUTRAL_BIAS = 2
export const MAX_BIAS = 4

// ---------- passive progress (auto-listening) ----------
// Listening is unverified: it earns progress on its own slower track that is
// converted into boxes, and it can never reach the milestones that require
// proof of knowledge.

/** Exposures needed for one passive box credit. */
export const HEARD_PER_CREDIT = 3
/** ...and they must be spread over at least this many distinct days, so looping
 * the same short playlist for an hour cannot buy progress. */
export const HEARD_MIN_DAYS = 2

/** The ceiling passive listening can raise each direction to. Both sit strictly
 * below the threshold they approach: recall unlock (recognition box 2) and
 * graduation (recall box 3) therefore always cost at least one real answer. */
export const PASSIVE_MAX_BOX: Record<Direction, number> = {
  recognition: RECALL_UNLOCK_BOX - 1,
  recall: GRADUATION_BOX - 1,
}

export function newReviewState(wordId: string, direction: Direction, today: string): ReviewState {
  return { wordId, direction, box: 0, dueAt: today, lapses: 0, streak: 0, introducedAt: today }
}

/** Counts one exposure. Repeats within the same day add to `count` but not to
 * `days`; only the days that matter for the rule are kept. */
export function addExposure(prev: Exposure | undefined, today: string): Exposure {
  const seen = prev?.days ?? []
  const days = seen.includes(today) ? seen : [...seen, today].slice(-HEARD_MIN_DAYS)
  return { count: (prev?.count ?? 0) + 1, days }
}

export function exposureReady(e: Exposure | undefined): boolean {
  return !!e && e.count >= HEARD_PER_CREDIT && e.days.length >= HEARD_MIN_DAYS
}

export function passiveCapReached(state: ReviewState): boolean {
  return state.box >= PASSIVE_MAX_BOX[state.direction]
}

/** One passive credit: a box step toward the direction's cap that deliberately
 * does NOT move `dueAt` — the word stays in the review queue on its old
 * schedule, so listening can never postpone being tested. */
export function applyPassive(state: ReviewState): ReviewState {
  if (passiveCapReached(state)) return state
  return { ...state, box: state.box + 1, passive: true }
}

/** A real answer always settles the passive question, so the flag clears either
 * way. A wrong first answer on a passively-raised word collapses the box to 0
 * instead of the usual -2: that progress was never earned. */
export function applyAnswer(state: ReviewState, correct: boolean, today: string): ReviewState {
  if (correct) {
    const box = Math.min(state.box + 1, MAX_BOX)
    return {
      ...state,
      box,
      streak: state.streak + 1,
      dueAt: addDays(today, INTERVALS_DAYS[box]),
      passive: undefined,
    }
  }
  return {
    ...state,
    box: state.passive ? 0 : Math.max(state.box - 2, 0),
    lapses: state.lapses + 1,
    streak: 0,
    dueAt: today,
    passive: undefined,
  }
}

export function shouldActivateRecall(recognition: ReviewState, recallExists: boolean): boolean {
  return recognition.direction === 'recognition' && recognition.box >= RECALL_UNLOCK_BOX && !recallExists
}

export function isGraduated(state: ReviewState): boolean {
  return state.direction === 'recall' && state.box >= GRADUATION_BOX
}

export interface SessionPlan {
  dueStates: ReviewState[]
  newWordIds: string[]
}

export function buildSessionPlan(args: {
  words: Word[]
  states: ReviewState[]
  today: string
  settings: { sessionSize: number; newWordsPerDay: number; categoryBias?: Record<string, number> }
  introducedToday: number
  /** limit the session to one word category */
  topic?: string | null
  /** the daily new-word cap is a pace guide, not a wall: let the learner push past it */
  ignoreNewLimit?: boolean
  /** listening difficulty votes per word, +1…+3 = hard (see game.ts listenRatings) */
  ratings?: Record<string, number>
}): SessionPlan {
  const { words, states, today, settings, introducedToday, topic, ignoreNewLimit, ratings = {} } = args
  const inTopic = topic ? new Set(words.filter((w) => w.category === topic).map((w) => w.id)) : null
  const rating = (wordId: string) => ratings[wordId] ?? 0
  const scoped = (wordId: string) => !inTopic || inTopic.has(wordId)
  // recall cards are the last step to mastery and are few — never let a large
  // overdue recognition backlog crowd them out of the session. Within a
  // direction, words flagged hard while listening go first: that verdict is the
  // learner saying out loud which words he cannot recognize.
  const due = states
    .filter((s) => s.dueAt <= today && scoped(s.wordId))
    .sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'recall' ? -1 : 1
      if (rating(a.wordId) !== rating(b.wordId)) return rating(b.wordId) - rating(a.wordId)
      return a.dueAt === b.dueAt ? a.box - b.box : a.dueAt < b.dueAt ? -1 : 1
    })
    .slice(0, settings.sessionSize)

  const known = new Set(states.map((s) => s.wordId))
  const room = Math.max(0, settings.sessionSize - due.length)
  const newAllowance = ignoreNewLimit ? Infinity : Math.max(0, settings.newWordsPerDay - introducedToday)
  // per-category bias: 0 = introduce new words from here first … 2 = neutral …
  // 4 = don't introduce new words at all (only repeat what's already learning).
  // A word already heard and flagged hard in listening jumps its bias group.
  const bias = (w: Word) => settings.categoryBias?.[w.category] ?? NEUTRAL_BIAS
  const newWordIds = words
    .filter((w) => !known.has(w.id) && scoped(w.id) && bias(w) < MAX_BIAS)
    .sort((a, b) => bias(a) - bias(b) || rating(b.id) - rating(a.id)) // stable within a group
    .slice(0, Math.min(room, newAllowance))
    .map((w) => w.id)

  // Whatever room is left over goes to hard-rated words that are not due yet.
  // Their schedule is untouched (a self-assessment must not move the SRS clock);
  // they simply get practised while there is space for them.
  const inSession = new Set(due.map((s) => `${s.wordId}|${s.direction}`))
  const extraRoom = Math.max(0, settings.sessionSize - due.length - newWordIds.length)
  const extras = states
    .filter((s) => rating(s.wordId) > 0 && scoped(s.wordId) && !inSession.has(`${s.wordId}|${s.direction}`))
    .sort((a, b) => rating(b.wordId) - rating(a.wordId) || (a.dueAt < b.dueAt ? -1 : 1))
    .slice(0, extraRoom)

  return { dueStates: [...due, ...extras], newWordIds }
}
