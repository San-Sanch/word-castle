import type { ReviewState, Word } from './types.js'

export const HIRE_COST = 150
export const MAX_LEVEL = 10
export const TRAINING_SET_SIZE = 20

/** Total sets to hold level L: triangular numbers. L2 costs 1 set, L3 three total, L10 forty-five. */
export function levelFromSets(sets: number): number {
  let level = 1
  while (level < MAX_LEVEL && sets >= ((level + 1) * level) / 2) level++
  return level
}

export function setsToNextLevel(sets: number): number {
  const level = levelFromSets(sets)
  if (level >= MAX_LEVEL) return 0
  return ((level + 1) * level) / 2 - sets
}

/** Training set: the guardian's category, due words first, then weakest boxes. */
export function buildTrainingSet(
  states: ReviewState[],
  words: Word[],
  category: string,
  today: string,
  size = TRAINING_SET_SIZE,
): ReviewState[] {
  const categoryIds = new Set(words.filter((w) => w.category === category).map((w) => w.id))
  return states
    .filter((s) => categoryIds.has(s.wordId))
    .sort((a, b) => {
      const aDue = a.dueAt <= today ? 0 : 1
      const bDue = b.dueAt <= today ? 0 : 1
      if (aDue !== bDue) return aDue - bDue
      return a.box - b.box
    })
    .slice(0, size)
}
