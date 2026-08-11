import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialGameState } from './game.js'
import { remapMergedProgress } from './mergeProgress.js'
import { newReviewState } from './srs.js'
import type { GameState } from './game.js'
import type { ReviewState } from './types.js'

const withReviews = (...reviews: ReviewState[]): GameState => ({ ...initialGameState(), reviews })
const R = (wordId: string, box: number, dir: 'recognition' | 'recall' = 'recognition'): ReviewState =>
  ({ ...newReviewState(wordId, dir, '2026-06-01'), box, dueAt: '2026-07-01' })

test('progress on a merged-away word moves to the survivor', () => {
  const s = remapMergedProgress(withReviews(R('dup', 3)), { dup: 'keep' })
  assert.equal(s.reviews.length, 1)
  assert.equal(s.reviews[0].wordId, 'keep')
  assert.equal(s.reviews[0].box, 3)
})

test('progress on both twins collapses to the further-along one', () => {
  const s = remapMergedProgress(withReviews(R('keep', 1), R('dup', 4)), { dup: 'keep' })
  assert.equal(s.reviews.length, 1)
  assert.equal(s.reviews[0].box, 4)
})

test('a verified box beats an equal passive one', () => {
  const passive = { ...R('dup', 2), passive: true }
  const s = remapMergedProgress(withReviews(R('keep', 2), passive), { dup: 'keep' })
  assert.equal(s.reviews.length, 1)
  assert.equal(s.reviews[0].passive, undefined)
})

test('both directions survive the merge independently', () => {
  const s = remapMergedProgress(
    withReviews(R('dup', 2, 'recognition'), R('dup', 1, 'recall')),
    { dup: 'keep' },
  )
  assert.deepEqual(
    s.reviews.map((r) => [r.wordId, r.direction, r.box]),
    [['keep', 'recognition', 2], ['keep', 'recall', 1]],
  )
})

test('graduated ids and exposures are remapped and deduped', () => {
  const base = withReviews()
  const s = remapMergedProgress(
    {
      ...base,
      graduatedIds: ['keep', 'dup'],
      exposures: { 'dup|recognition': { count: 2, days: ['2026-07-25'] }, 'keep|recognition': { count: 1, days: ['2026-07-24'] } },
    },
    { dup: 'keep' },
  )
  assert.deepEqual(s.graduatedIds, ['keep'])
  assert.deepEqual(Object.keys(s.exposures), ['keep|recognition'])
  assert.equal(s.exposures['keep|recognition'].count, 2, 'counters are not summed')
})

test('a state with nothing to remap is returned untouched', () => {
  const s = withReviews(R('other', 2))
  assert.equal(remapMergedProgress(s, { dup: 'keep' }), s)
  assert.equal(remapMergedProgress(s, {}), s)
})
