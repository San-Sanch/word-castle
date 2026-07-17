import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32, makeChoice, makeBlank, makeMatch, makeSentenceChoice, pickExerciseKind } from './exercises.js'
import type { Sentence, Word } from './types.js'

const S = (id: string, hebrew: string, translation: string): Sentence => ({
  id, hebrew, translation, tokens: hebrew.split(' '), matches: [],
})

const W = (id: string, opts: Partial<Word> = {}): Word => ({
  id, hebrew: 'h' + id, hebrewFull: 'h' + id, gender: null, plural: null,
  translation: 't' + id, translationLang: 'ua', category: 'Family', ...opts,
})

const pool = [
  W('1'), W('2'), W('3'), W('4'), W('5'),
  W('6', { category: 'Verbs' }), W('7', { translationLang: 'en' }),
]

test('makeChoice recognition: hebrew prompt, up to 8 options, correct present once', () => {
  const rng = mulberry32(42)
  const ex = makeChoice(pool[0], 'recognition', pool, rng)
  assert.equal(ex.kind, 'choice')
  assert.equal(ex.prompt, 'h1')
  assert.equal(ex.options.length, 7) // whole pool fits under the 8 cap
  assert.equal(ex.options.filter((o) => o === 't1').length, 1)
  assert.equal(ex.options[ex.correctIndex], 't1')
})

test('makeChoice: same-language distractors preferred when the pool is big enough', () => {
  const big = [
    W('1'),
    ...Array.from({ length: 12 }, (_, i) => W(`ua${i}`)),
    W('en1', { translationLang: 'en' }),
  ]
  const ex = makeChoice(big[0], 'recognition', big, mulberry32(6))
  assert.equal(ex.options.length, 8)
  assert.ok(!ex.options.includes('ten1'), 'english distractor leaked into a ua word')
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

test('makeChoice: single-word answers prefer single words, pad only when they run out', () => {
  const target = W('t', { translation: 'uncle' })
  const singles = Array.from({ length: 9 }, (_, i) => W(`s${i}`, { translation: `word${i}` }))
  const phrases = [W('p1', { translation: 'this is a long sentence' })]
  // plenty of single words: no phrase in the 8
  const ex = makeChoice(target, 'recognition', [target, ...singles, ...phrases], mulberry32(2))
  assert.equal(ex.options.length, 8)
  assert.ok(!ex.options.includes('this is a long sentence'))
  // too few single words: still 8 options, padded with the closest shapes
  const small = makeChoice(target, 'recognition', [target, ...singles.slice(0, 3), ...phrases,
    W('p2', { translation: 'have a nice day' }), W('p3', { translation: 'see you soon' }),
    W('p4', { translation: 'bon appetit my dear friend' })], mulberry32(2))
  assert.equal(small.options.length, 8)
  for (const s of ['word0', 'word1', 'word2']) assert.ok(small.options.includes(s))
})

test('makeChoice: phrase answers prefer similar-length distractors when available', () => {
  const target = W('t', { translation: 'good morning friend' })
  const close = Array.from({ length: 8 }, (_, i) => W(`c${i}`, { translation: `nice long phrase ${i}` }))
  const ex = makeChoice(target, 'recognition', [target, ...close, W('y', { translation: 'yes' })], mulberry32(3))
  assert.equal(ex.options.length, 8)
  // 'yes' (1 token vs 3) stays out while enough close candidates exist
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

test('makeSentenceChoice: English prompt, 8 Hebrew sentence options', () => {
  const pool = Array.from({ length: 12 }, (_, i) => S(`s${i}`, `אני לומד עברית ${i}`, `I study Hebrew ${i}`))
  const ex = makeSentenceChoice(pool[0], pool, mulberry32(4))
  assert.equal(ex.kind, 'sentchoice')
  assert.equal(ex.prompt, 'I study Hebrew 0')
  assert.equal(ex.options.length, 8)
  assert.equal(ex.options[ex.correctIndex], 'אני לומד עברית 0')
  assert.equal(new Set(ex.options).size, 8)
})

test('makeSentenceChoice reverse: Hebrew prompt, translation options', () => {
  const pool = Array.from({ length: 10 }, (_, i) => S(`s${i}`, `משפט מספר ${i}`, `sentence number ${i}`))
  const ex = makeSentenceChoice(pool[2], pool, mulberry32(9), true)
  assert.equal(ex.prompt, 'משפט מספר 2')
  assert.equal(ex.options[ex.correctIndex], 'sentence number 2')
})

test('pickExerciseKind: blank only when enabled, box>=2 and sentence exists', () => {
  const settings = { choice: true, blank: true }
  assert.equal(pickExerciseKind({ box: 0, hasSentence: true, settings, roll: 0.1 }), 'choice')
  assert.equal(pickExerciseKind({ box: 3, hasSentence: false, settings, roll: 0.1 }), 'choice')
  assert.equal(pickExerciseKind({ box: 3, hasSentence: true, settings, roll: 0.1 }), 'blank')
  assert.equal(pickExerciseKind({ box: 3, hasSentence: true, settings, roll: 0.9 }), 'choice')
  assert.equal(pickExerciseKind({ box: 3, hasSentence: true, settings: { choice: true, blank: false }, roll: 0.1 }), 'choice')
})

test('makeChoice: distractors that differ only by case/punctuation are excluded', () => {
  const target = W('bye', { hebrew: 'להתראות', translation: 'goodbye' })
  const dupes = [
    W('bye2', { hebrew: 'שלום', translation: 'Goodbye!' }),
    W('bye3', { hebrew: 'ביי', translation: ' goodbye ' }),
  ]
  const filler = Array.from({ length: 8 }, (_, i) => W(`f${i}`))
  for (let seed = 1; seed <= 5; seed++) {
    const ex = makeChoice(target, 'recognition', [target, ...dupes, ...filler], mulberry32(seed))
    const normed = ex.options.map((o) => o.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim())
    assert.equal(normed.filter((o) => o === 'goodbye').length, 1, `seed ${seed}: ${ex.options}`)
  }
})
