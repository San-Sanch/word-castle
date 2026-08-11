import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAutoPlaylist,
  pauseAfterMs,
  clampPauseSec,
  GAP_AFTER_PAIR_MS,
  PAUSE_MIN_SEC,
  PAUSE_MAX_SEC,
} from './autoListen.js'
import { mulberry32 } from './exercises.js'
import { newReviewState } from './srs.js'
import type { ReviewState, Sentence, Word } from './types.js'

const W = (id: string, category = 'Family'): Word => ({
  id, hebrew: 'he-' + id, hebrewFull: 'he-' + id, gender: null, plural: null,
  translation: 't-' + id, translationLang: 'en', category,
})
const S = (id: string, matches: Array<{ tokenIndex: number; wordId: string }> = []): Sentence =>
  ({ id, hebrew: 'sh-' + id, translation: 'st-' + id, matches, tokens: [] })
const keys = (items: { key: string }[]) => new Set(items.map((i) => i.key))

test('words mode: learning words always included; new words gated by category bias', () => {
  const words = [W('L1', 'A'), W('L2', 'A'), W('N1', 'A'), W('N2', 'A'), W('N3', 'B')]
  const reviews: ReviewState[] = [
    newReviewState('L1', 'recognition', '2026-07-01'),
    newReviewState('L2', 'recognition', '2026-07-01'),
  ]
  const out = buildAutoPlaylist({
    words, reviews, content: 'words',
    categoryBias: { A: 4, B: 0 }, // A: no new words, B: all new words
    rng: mulberry32(1),
  })
  assert.deepEqual(keys(out), new Set(['w:L1', 'w:L2', 'w:N3']))
  assert.ok(out.every((i) => i.wordId)) // words carry wordId for flagging
})

test('neutral bias takes about half the new words in a category', () => {
  const words = [W('L1'), ...['n1', 'n2', 'n3', 'n4'].map((id) => W(id))]
  const reviews = [newReviewState('L1', 'recognition', '2026-07-01')]
  const out = buildAutoPlaylist({ words, reviews, content: 'words', categoryBias: { Family: 2 }, rng: mulberry32(3) })
  const newCount = out.filter((i) => i.key.startsWith('w:') && i.key !== 'w:L1').length
  assert.equal(newCount, 2) // round(4 * (4-2)/4) = 2
})

test('sentences mode: only sentence items', () => {
  const words = [W('L1')]
  const reviews = [newReviewState('L1', 'recognition', '2026-07-01')]
  const out = buildAutoPlaylist({ words, reviews, sentences: [S('a'), S('b')], content: 'sentences', rng: mulberry32(1) })
  assert.deepEqual(keys(out), new Set(['s:a', 's:b']))
  assert.ok(out.every((i) => !i.wordId))
})

test('both mode: learning words plus sentences', () => {
  const words = [W('L1'), W('N1')]
  const reviews = [newReviewState('L1', 'recognition', '2026-07-01')]
  const out = buildAutoPlaylist({
    words, reviews, sentences: [S('a')], content: 'both',
    categoryBias: { Family: 4 }, rng: mulberry32(1),
  })
  assert.deepEqual(keys(out), new Set(['w:L1', 's:a']))
})

test('category filter restricts words, and sentences via their matched words', () => {
  const words = [W('a', 'A'), W('b', 'B')]
  const reviews = [
    newReviewState('a', 'recognition', '2026-07-01'),
    newReviewState('b', 'recognition', '2026-07-01'),
  ]
  const sentences = [S('s1', [{ tokenIndex: 0, wordId: 'a' }]), S('s2', [{ tokenIndex: 0, wordId: 'b' }])]
  const out = buildAutoPlaylist({ words, reviews, sentences, content: 'both', category: 'A', rng: mulberry32(1) })
  assert.deepEqual(keys(out), new Set(['w:a', 's:s1']))
})

test('same seed is deterministic; the list is actually shuffled', () => {
  const words = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => W(id))
  const reviews = words.map((w) => newReviewState(w.id, 'recognition', '2026-07-01'))
  const a = buildAutoPlaylist({ words, reviews, content: 'words', shuffle: true, rng: mulberry32(7) })
  const b = buildAutoPlaylist({ words, reviews, content: 'words', shuffle: true, rng: mulberry32(7) })
  assert.deepEqual(a.map((i) => i.key), b.map((i) => i.key)) // reproducible
  const inputOrder = words.map((w) => 'w:' + w.id).join(',')
  assert.notEqual(a.map((i) => i.key).join(','), inputOrder) // not just source order
})

test('ordered (default): most-overdue reviews first, then new words in dataset order', () => {
  const words = [W('a'), W('b'), W('n1'), W('n2')]
  const reviews: ReviewState[] = [
    { ...newReviewState('a', 'recognition', '2026-06-01'), dueAt: '2026-07-05' },
    { ...newReviewState('b', 'recognition', '2026-06-01'), dueAt: '2026-07-02' }, // more overdue
  ]
  const out = buildAutoPlaylist({ words, reviews, content: 'words', categoryBias: { Family: 0 } })
  assert.deepEqual(out.map((i) => i.key), ['w:b', 'w:a', 'w:n1', 'w:n2'])
})

test('rated order: difficult words first, easy last, unrated in between', () => {
  const words = ['a', 'b', 'c', 'd'].map((id) => W(id))
  const reviews = words.map((w) => newReviewState(w.id, 'recognition', '2026-07-01'))
  const out = buildAutoPlaylist({
    words, reviews, content: 'words', shuffle: true, ratedOrder: true,
    ratings: { a: -2, b: 3, d: 1 }, rng: mulberry32(5),
  })
  assert.deepEqual(out.map((i) => i.key), ['w:b', 'w:d', 'w:c', 'w:a'])
})

test('rated order: ties keep the shuffled order (same as plain shuffle when nothing is rated)', () => {
  const words = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => W(id))
  const reviews = words.map((w) => newReviewState(w.id, 'recognition', '2026-07-01'))
  const plain = buildAutoPlaylist({ words, reviews, content: 'words', shuffle: true, rng: mulberry32(7) })
  const rated = buildAutoPlaylist({
    words, reviews, content: 'words', shuffle: true, ratedOrder: true, ratings: {}, rng: mulberry32(7),
  })
  assert.deepEqual(rated.map((i) => i.key), plain.map((i) => i.key))
})

test('rated order: sentences are unrated (neutral), so rated-hard words come before them', () => {
  const words = [W('a')]
  const reviews = [newReviewState('a', 'recognition', '2026-07-01')]
  const out = buildAutoPlaylist({
    words, reviews, sentences: [S('s1')], content: 'both', shuffle: true, ratedOrder: true,
    ratings: { a: 2 }, rng: mulberry32(1),
  })
  assert.deepEqual(out.map((i) => i.key), ['w:a', 's:s1'])
})

test('rated order off: ratings are ignored in shuffle mode', () => {
  const words = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => W(id))
  const reviews = words.map((w) => newReviewState(w.id, 'recognition', '2026-07-01'))
  const withRatings = buildAutoPlaylist({
    words, reviews, content: 'words', shuffle: true, ratings: { f: 3, a: -3 }, rng: mulberry32(7),
  })
  const without = buildAutoPlaylist({ words, reviews, content: 'words', shuffle: true, rng: mulberry32(7) })
  assert.deepEqual(withRatings.map((i) => i.key), without.map((i) => i.key))
})

test('pause scales up for longer phrases and sentences', () => {
  assert.equal(pauseAfterMs('ילד'), 3000)
  assert.equal(pauseAfterMs('אני אוהב לשבת ולקרוא ספרים בבית'), 4500)
  assert.ok(GAP_AFTER_PAIR_MS >= 1000)
})

test('pauseAfterMs scales the chosen base, and pauses clamp to 1..20s', () => {
  assert.equal(pauseAfterMs('ילד', 5000), 5000)
  assert.equal(pauseAfterMs('אני אוהב לשבת ולקרוא ספרים בבית', 5000), 7500) // long: 1.5x
  assert.equal(clampPauseSec(7, 3), 7)
  assert.equal(clampPauseSec(0, 3), PAUSE_MIN_SEC)
  assert.equal(clampPauseSec(99, 3), PAUSE_MAX_SEC)
  assert.equal(clampPauseSec(NaN, 3), 3) // corrupt setting falls back
  assert.equal(clampPauseSec(4.6, 3), 5)
})
