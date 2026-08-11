import { LISTEN_RATING_MIN } from './game.js'

/**
 * Where a word stands, combining the two things known about it:
 *
 * - **evidence** — the SRS boxes, earned by answering under test conditions;
 * - **confidence** — the listening rating, Sanch's own ⌄⌄ / ⌃⌃ verdict while the
 *   word is being spoken.
 *
 * Listening is the main exercise, so its verdict has to count; but it is
 * self-assessment, not a test, so the two are weighted differently. Easy votes
 * accumulate towards mastery (each one needs the word to have played again, so
 * the full scale is several separate "I knew it instantly" moments), while a
 * single hard vote is enough to take mastery away — failing to recognize a word
 * out loud is direct evidence, and one easy vote puts it back.
 */
export interface WordStanding {
  /** the word has been met at all — in a session or in listening */
  started: boolean
  /** counts as known */
  mastered: boolean
  /** rated hard: recognized poorly by ear, whatever the boxes say */
  needsWork: boolean
}

/** The rating at which listening alone is accepted as mastery (the easy end). */
export const EASY_MASTERY_RATING = LISTEN_RATING_MIN

export function wordStanding(args: {
  /** listening rating, -3 (easy) … +3 (hard); 0 when never rated */
  rating: number
  /** a review state exists for the word (any direction) */
  hasReview: boolean
  /** the SRS graduation bar is cleared */
  graduated: boolean
}): WordStanding {
  const { rating, hasReview, graduated } = args
  const needsWork = rating > 0
  return {
    started: hasReview || rating !== 0,
    mastered: !needsWork && (graduated || rating <= EASY_MASTERY_RATING),
    needsWork,
  }
}

export type StandingLabel = 'new' | 'learning' | 'needs work' | 'mastered'

export function standingLabel(s: WordStanding): StandingLabel {
  if (s.needsWork) return 'needs work'
  if (s.mastered) return 'mastered'
  return s.started ? 'learning' : 'new'
}
