import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32, makeChoice, makeBlank, makeMatch, pickExerciseKind } from './exercises.js'
import type { Sentence, Word } from './types.js'

const W = (id: string, opts: Partial<Word> = {}): Word => ({
  id, hebrew: 'h' + id, hebrewFull: 'h' + id, gender: null, plural: null,
  translation: 't' + id, translationLang: 'ua', category: 'Family', ...opts,
})

const pool = [
  W('1'), W('2'), W('3'), W('4'), W('5'),
  W('6', { category: 'Verbs' }), W('7', { translationLang: 'en' }),
]

test('makeChoice recognition: hebrew prompt, translation options, correct present once', () => {
  const rng = mulberry32(42)
  const ex = makeChoice(pool[0], 'recognition', pool, rng)
  assert.equal(ex.kind, 'choice')
  assert.equal(ex.prompt, 'h1')
  assert.equal(ex.options.length, 4)
  assert.equal(ex.options.filter((o) => o === 't1').length, 1)
  assert.equal(ex.options[ex.correctIndex], 't1')
  // distractors share the translation language (no en options among ua)
  for (const o of ex.options) assert.match(o, /^t/)
  assert.ok(!ex.options.includes('t7'))
})

test('makeChoice recall: translation prompt, hebrew options', () => {
  const rng = mulberry32(7)
  const ex = makeChoice(pool[1], 'recall', pool, rng)
  assert.equal(ex.prompt, 't2')
  assert.equal(ex.options[ex.correctIndex], 'h2')
})

test('makeChoice: small pools still produce 4 unique options or fewer without crash', () => {
  const rng = mulberry32(1)
  const ex = makeChoice(pool[0], 'recognition', pool.slice(0, 2), rng)
  assert.ok(ex.options.length >= 2)
  assert.equal(new Set(ex.options).size, ex.options.length)
})

test('makeChoice: option count is configurable (8 for listening)', () => {
  const big = Array.from({ length: 20 }, (_, i) => W(String(i + 10)))
  const ex = makeChoice(big[0], 'recognition', big, mulberry32(4), 8)
  assert.equal(ex.options.length, 8)
  assert.equal(new Set(ex.options).size, 8)
})

test('makeChoice: single-word answers never get phrase distractors', () => {
  const target = W('t', { translation: 'uncle' })
  const phrases = [
    W('p1', { translation: 'this is a long sentence' }),
    W('p2', { translation: 'I am having a great time' }),
    W('p3', { translation: 'bon appetit friend' }),
  ]
  const singles = [W('s1', { translation: 'aunt' }), W('s2', { translation: 'cousin' }), W('s3', { translation: 'nephew' })]
  const ex = makeChoice(target, 'recognition', [target, ...phrases, ...singles], mulberry32(2))
  for (const o of ex.options) {
    assert.equal(o.trim().split(/\s+/).length, 1, `phrase leaked into options: "${o}"`)
  }
})

test('makeChoice: phrase answers prefer similar-length distractors', () => {
  const target = W('t', { translation: 'good morning friend' })
  const mixed = [
    W('a', { translation: 'see you later everyone' }),
    W('b', { translation: 'have a nice day' }),
    W('c', { translation: 'yes' }),
    W('d', { translation: 'good evening dear friend' }),
  ]
  const ex = makeChoice(target, 'recognition', [target, ...mixed], mulberry32(3))
  // 'yes' (1 token vs 3) is out of shape; with enough close candidates it stays out
  assert.ok(!ex.options.includes('yes'), ex.options.join(','))
})

test('makeBlank: blanks the matched token, options include the word', () => {
  const words = [W('1', { hebrew: 'עברית' }), W('2', { hebrew: 'יין' }), W('3'), W('4')]
  const s: Sentence = {
    id: 's1', hebrew: 'אני לומד עברית', translation: 'I study Hebrew',
    tokens: ['אני', 'לומד', 'עברית'],
    matches: [{ tokenIndex: 2, wordId: '1' }],
  }
  const ex = makeBlank(s, s.matches[0], words, mulberry32(3))
  assert.equal(ex.kind, 'blank')
  assert.equal(ex.blankIndex, 2)
  assert.equal(ex.options[ex.correctIndex], 'עברית')
  assert.equal(new Set(ex.options).size, ex.options.length)
})

test('makeMatch: 5 pairs, both orders are permutations', () => {
  const ex = makeMatch(pool.slice(0, 5), mulberry32(9))
  assert.equal(ex.kind, 'match')
  assert.equal(ex.pairs.length, 5)
  assert.deepEqual([...ex.leftOrder].sort(), [0, 1, 2, 3, 4])
  assert.deepEqual([...ex.rightOrder].sort(), [0, 1, 2, 3, 4])
})

test('pickExerciseKind: blank only when enabled, box>=2 and sentence exists', () => {
  const settings = { choice: true, blank: true }
  assert.equal(pickExerciseKind({ box: 0, hasSentence: true, settings, roll: 0.1 }), 'choice')
  assert.equal(pickExerciseKind({ box: 3, hasSentence: false, settings, roll: 0.1 }), 'choice')
  assert.equal(pickExerciseKind({ box: 3, hasSentence: true, settings, roll: 0.1 }), 'blank')
  assert.equal(pickExerciseKind({ box: 3, hasSentence: true, settings, roll: 0.9 }), 'choice')
  assert.equal(pickExerciseKind({ box: 3, hasSentence: true, settings: { choice: true, blank: false }, roll: 0.1 }), 'choice')
})
