import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EASY_MASTERY_RATING, wordStanding, standingLabel } from './wordStatus.js'

const S = (o: Partial<Parameters<typeof wordStanding>[0]> = {}) =>
  wordStanding({ rating: 0, hasReview: false, graduated: false, ...o })

test('untouched word: not started, not mastered', () => {
  const s = S()
  assert.deepEqual(s, { started: false, mastered: false, needsWork: false })
  assert.equal(standingLabel(s), 'new')
})

test('a rating alone counts as started — listening is where words are met', () => {
  assert.equal(S({ rating: -1 }).started, true)
  assert.equal(S({ rating: 1 }).started, true)
  assert.equal(S({ hasReview: true }).started, true)
})

test('sessions still master a word on their own', () => {
  const s = S({ hasReview: true, graduated: true })
  assert.equal(s.mastered, true)
  assert.equal(standingLabel(s), 'mastered')
})

test('listening alone masters a word once every easy vote is in', () => {
  assert.equal(S({ rating: -2 }).mastered, false, 'partway is not enough')
  assert.equal(S({ rating: EASY_MASTERY_RATING }).mastered, true)
})

test('a hard vote overrides mastery — it is direct evidence he cannot recognize it', () => {
  const s = S({ hasReview: true, graduated: true, rating: 1 })
  assert.deepEqual(s, { started: true, mastered: false, needsWork: true })
  assert.equal(standingLabel(s), 'needs work')
})

test('a hard vote taken back restores mastery', () => {
  assert.equal(S({ hasReview: true, graduated: true, rating: 0 }).mastered, true)
})

test('started but undecided reads as learning', () => {
  assert.equal(standingLabel(S({ hasReview: true })), 'learning')
  assert.equal(standingLabel(S({ rating: -1 })), 'learning')
})
