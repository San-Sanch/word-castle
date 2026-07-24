import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAutoPlaylist, pauseAfterMs, GAP_AFTER_PAIR_MS } from './autoListen.js'
import { newReviewState } from './srs.js'
import type { ReviewState, Word } from './types.js'

const W = (id: string): Word => ({
  id, hebrew: id, hebrewFull: id, gender: null, plural: null,
  translation: 't-' + id, translationLang: 'en', category: 'Family',
})

test('playlist: words in learning only - due first, then upcoming by dueAt', () => {
  const words = [W('a'), W('b'), W('c'), W('d')]
  const states: ReviewState[] = [
    { ...newReviewState('a', 'recognition', '2026-06-01'), dueAt: '2026-08-01' }, // not due
    { ...newReviewState('b', 'recognition', '2026-06-01'), dueAt: '2026-07-02' }, // overdue
    { ...newReviewState('c', 'recognition', '2026-06-01'), dueAt: '2026-07-01' }, // more overdue
    // 'd' never started -> excluded
  ]
  assert.deepEqual(buildAutoPlaylist(words, states), ['c', 'b', 'a'])
})

test('playlist: a word with recognition+recall states appears once, at its earliest dueAt', () => {
  const words = [W('a'), W('b')]
  const states: ReviewState[] = [
    { ...newReviewState('a', 'recognition', '2026-06-01'), dueAt: '2026-08-01' },
    { ...newReviewState('a', 'recall', '2026-06-10'), dueAt: '2026-07-01' },
    { ...newReviewState('b', 'recognition', '2026-06-01'), dueAt: '2026-07-02' },
  ]
  assert.deepEqual(buildAutoPlaylist(words, states), ['a', 'b'])
})

test('playlist: states for words missing from the course word list are dropped', () => {
  const states: ReviewState[] = [{ ...newReviewState('ghost', 'recognition', '2026-06-01'), dueAt: '2026-07-01' }]
  assert.deepEqual(buildAutoPlaylist([W('a')], states), [])
})

test('pause scales up for longer phrases and sentences', () => {
  assert.equal(pauseAfterMs('ילד'), 3000)
  assert.equal(pauseAfterMs('אני אוהב לשבת ולקרוא ספרים בבית'), 4500)
  assert.ok(GAP_AFTER_PAIR_MS >= 1000)
})
