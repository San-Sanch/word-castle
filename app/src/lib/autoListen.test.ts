import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAutoPlaylist, pauseAfterMs, GAP_AFTER_PAIR_MS } from './autoListen.js'
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
  const a = buildAutoPlaylist({ words, reviews, content: 'words', rng: mulberry32(7) })
  const b = buildAutoPlaylist({ words, reviews, content: 'words', rng: mulberry32(7) })
  assert.deepEqual(a.map((i) => i.key), b.map((i) => i.key)) // reproducible
  const inputOrder = words.map((w) => 'w:' + w.id).join(',')
  assert.notEqual(a.map((i) => i.key).join(','), inputOrder) // not just source order
})

test('pause scales up for longer phrases and sentences', () => {
  assert.equal(pauseAfterMs('ילד'), 3000)
  assert.equal(pauseAfterMs('אני אוהב לשבת ולקרוא ספרים בבית'), 4500)
  assert.ok(GAP_AFTER_PAIR_MS >= 1000)
})
