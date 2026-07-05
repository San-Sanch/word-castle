import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeSoundMatch, hebrewSimilarity, mulberry32 } from './exercises.js'
import type { Word } from './types.js'

const W = (id: string, hebrew: string): Word => ({
  id, hebrew, hebrewFull: hebrew, gender: null, plural: null,
  translation: 't' + id, translationLang: 'en', category: 'Family',
})

const pool = [
  W('1', 'שלום'), W('2', 'שלוש'), W('3', 'שלושה'), W('4', 'שלג'),
  W('5', 'שולחן'), W('6', 'מים'), W('7', 'לחם'), W('8', 'ילד'), W('9', 'שיר'),
  W('10', 'שמש'), W('11', 'שנה'), W('12', 'שיחה'),
]

test('hebrewSimilarity: closer strings score higher', () => {
  const target = 'שלום'
  const close = hebrewSimilarity(target, 'שלוש') // shared prefix + length
  const far = hebrewSimilarity(target, 'ילד')
  assert.ok(close > far, `${close} > ${far}`)
})

test('makeSoundMatch: 8 unique options including the target', () => {
  const ex = makeSoundMatch(pool[0], pool, mulberry32(5))
  assert.equal(ex.kind, 'sound')
  assert.equal(ex.options.length, 8)
  assert.equal(new Set(ex.options).size, 8)
  assert.equal(ex.options[ex.correctIndex], 'שלום')
  assert.equal(ex.wordId, '1')
  // distractors lean similar: ש-family words dominate
  const shWords = ex.options.filter((o) => o.startsWith('ש'))
  assert.ok(shWords.length >= 4, `similar options expected, got ${ex.options.join(',')}`)
})

test('makeSoundMatch: single-word target excludes phrases', () => {
  const withPhrases = [...pool, W('20', 'ארוחת בוקר טובה'), W('21', 'מה שלומך היום')]
  const ex = makeSoundMatch(pool[0], withPhrases, mulberry32(7))
  for (const o of ex.options) {
    assert.equal(o.includes(' '), false, `phrase leaked: "${o}"`)
  }
})

test('makeSoundMatch: slash-variant dictionary entries never appear as options', () => {
  const withSlash = [...pool, W('30', 'אחרון/אחרונה/אחרונים/אחרונות'), W('31', 'שלו/שלה')]
  const ex = makeSoundMatch(pool[0], withSlash, mulberry32(11))
  for (const o of ex.options) {
    assert.equal(o.includes('/'), false, `slash entry leaked: "${o}"`)
  }
})

test('makeSoundMatch: small pool yields fewer options without crash', () => {
  const ex = makeSoundMatch(pool[0], pool.slice(0, 3), mulberry32(1))
  assert.ok(ex.options.length >= 2 && ex.options.length <= 6)
  assert.equal(ex.options[ex.correctIndex], 'שלום')
})

// --- find-the-original: near-miss spelling distractors ---
import { makeFindOriginal } from './exercises.js'

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

test('makeFindOriginal: 8 unique options, distractors within 1-2 letter edits', () => {
  const word = W('t', 'מחברת')
  const ex = makeFindOriginal({ ...word, translation: 'notebook' }, mulberry32(5))
  assert.equal(ex.kind, 'choice')
  assert.equal(ex.direction, 'recall')
  assert.equal(ex.prompt, 'notebook')
  assert.equal(ex.options.length, 8)
  assert.equal(new Set(ex.options).size, 8)
  assert.equal(ex.options[ex.correctIndex], 'מחברת')
  for (const o of ex.options) {
    if (o === 'מחברת') continue
    const d = levenshtein(o, 'מחברת')
    assert.ok(d >= 1 && d <= 2, `distractor "${o}" is ${d} edits away`)
  }
})

test('makeFindOriginal: final letters stay well-formed', () => {
  const ex = makeFindOriginal({ ...W('t', 'שולחן'), translation: 'table' }, mulberry32(9))
  for (const o of ex.options) {
    // no final forms mid-word
    assert.ok(!/[םןץףך]./.test(o), `internal final letter in "${o}"`)
    // no non-final מנצפכ at the end
    assert.ok(!/[מנצפכ]$/.test(o), `non-final ending in "${o}"`)
  }
})

test('makeFindOriginal: deterministic per seed and works for short words', () => {
  const a = makeFindOriginal({ ...W('t', 'בת'), translation: 'daughter' }, mulberry32(3))
  const b = makeFindOriginal({ ...W('t', 'בת'), translation: 'daughter' }, mulberry32(3))
  assert.deepEqual(a, b)
  assert.ok(a.options.length >= 4)
})
