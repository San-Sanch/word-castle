import type { Direction, ReviewState, Word } from './types.js'
import { addDays } from './time.js'

export const INTERVALS_DAYS = [0, 1, 2, 4, 8, 16, 32, 64]
export const MAX_BOX = INTERVALS_DAYS.length - 1

/** Recognition box at which the recall direction unlocks. */
export const RECALL_UNLOCK_BOX = 3
/** Recall box at which a word graduates (pays bonus, becomes a brick). */
export const GRADUATION_BOX = 4

export function newReviewState(wordId: string, direction: Direction, today: string): ReviewState {
  return { wordId, direction, box: 0, dueAt: today, lapses: 0, streak: 0, introducedAt: today }
}

export function applyAnswer(state: ReviewState, correct: boolean, today: string): ReviewState {
  if (correct) {
    const box = Math.min(state.box + 1, MAX_BOX)
    return { ...state, box, streak: state.streak + 1, dueAt: addDays(today, INTERVALS_DAYS[box]) }
  }
  return {
    ...state,
    box: Math.max(state.box - 2, 0),
    lapses: state.lapses + 1,
    streak: 0,
    dueAt: today,
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
  settings: { sessionSize: number; newWordsPerDay: number }
  introducedToday: number
  /** limit the session to one word category */
  topic?: string | null
  /** the daily new-word cap is a pace guide, not a wall: let the learner push past it */
  ignoreNewLimit?: boolean
}): SessionPlan {
  const { words, states, today, settings, introducedToday, topic, ignoreNewLimit } = args
  const inTopic = topic ? new Set(words.filter((w) => w.category === topic).map((w) => w.id)) : null
  const due = states
    .filter((s) => s.dueAt <= today && (!inTopic || inTopic.has(s.wordId)))
    .sort((a, b) => (a.dueAt === b.dueAt ? a.box - b.box : a.dueAt < b.dueAt ? -1 : 1))
    .slice(0, settings.sessionSize)

  const known = new Set(states.map((s) => s.wordId))
  const room = Math.max(0, settings.sessionSize - due.length)
  const newAllowance = ignoreNewLimit ? Infinity : Math.max(0, settings.newWordsPerDay - introducedToday)
  const newWordIds = words
    .filter((w) => !known.has(w.id) && (!inTopic || inTopic.has(w.id)))
    .slice(0, Math.min(room, newAllowance))
    .map((w) => w.id)

  return { dueStates: due, newWordIds }
}
