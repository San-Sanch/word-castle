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
]

test('hebrewSimilarity: closer strings score higher', () => {
  const target = 'שלום'
  const close = hebrewSimilarity(target, 'שלוש') // shared prefix + length
  const far = hebrewSimilarity(target, 'ילד')
  assert.ok(close > far, `${close} > ${far}`)
})

test('makeSoundMatch: 6 unique options including the target', () => {
  const ex = makeSoundMatch(pool[0], pool, mulberry32(5))
  assert.equal(ex.kind, 'sound')
  assert.equal(ex.options.length, 6)
  assert.equal(new Set(ex.options).size, 6)
  assert.equal(ex.options[ex.correctIndex], 'שלום')
  assert.equal(ex.wordId, '1')
  // distractors lean similar: at least 2 of the ש-family words present
  const shWords = ex.options.filter((o) => o.startsWith('ש'))
  assert.ok(shWords.length >= 3, `similar options expected, got ${ex.options.join(',')}`)
})

test('makeSoundMatch: small pool yields fewer options without crash', () => {
  const ex = makeSoundMatch(pool[0], pool.slice(0, 3), mulberry32(1))
  assert.ok(ex.options.length >= 2 && ex.options.length <= 6)
  assert.equal(ex.options[ex.correctIndex], 'שלום')
})
