import { test } from 'node:test'
import assert from 'node:assert/strict'
import { levelFromSets, setsToNextLevel, HIRE_COST, buildTrainingSet } from './guardian.js'
import { newReviewState } from './srs.js'
import type { ReviewState, Word } from './types.js'

test('levelFromSets: triangular curve, capped at 10', () => {
  assert.equal(levelFromSets(0), 1)
  assert.equal(levelFromSets(1), 2)
  assert.equal(levelFromSets(2), 2)
  assert.equal(levelFromSets(3), 3)
  assert.equal(levelFromSets(6), 4)
  assert.equal(levelFromSets(45), 10)
  assert.equal(levelFromSets(999), 10)
})

test('setsToNextLevel', () => {
  assert.equal(setsToNextLevel(0), 1) // 1 set to reach L2
  assert.equal(setsToNextLevel(1), 2) // 2 more for L3
  assert.equal(setsToNextLevel(45), 0) // maxed
})

test('hire cost', () => assert.equal(HIRE_COST, 150))

test('buildTrainingSet: category words, due first then lowest box', () => {
  const W = (id: string, category: string): Word => ({
    id, hebrew: id, hebrewFull: id, gender: null, plural: null,
    translation: id, translationLang: 'ua', category,
  })
  const words = [W('a', 'Verbs'), W('b', 'Verbs'), W('c', 'Verbs'), W('x', 'Family')]
  const states: ReviewState[] = [
    { ...newReviewState('a', 'recognition', '2026-06-01'), box: 5, dueAt: '2026-08-01' },
    { ...newReviewState('b', 'recognition', '2026-06-01'), box: 2, dueAt: '2026-07-01' }, // due
    { ...newReviewState('c', 'recognition', '2026-06-01'), box: 1, dueAt: '2026-08-01' },
    { ...newReviewState('x', 'recognition', '2026-06-01'), box: 0, dueAt: '2026-07-01' },
  ]
  const set = buildTrainingSet(states, words, 'Verbs', '2026-07-04', 2)
  assert.deepEqual(set.map((s) => s.wordId), ['b', 'c']) // due first, then lowest box; x excluded
})
