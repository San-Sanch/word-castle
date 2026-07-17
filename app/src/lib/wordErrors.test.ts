import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorIcon, statusAfterReport, wordsWithErrors, showSpellingWarning } from './wordErrors.js'
import type { Word } from './types.js'

const w = (id: string): Word => ({
  id, hebrew: id, hebrewFull: id, gender: null, plural: null,
  translation: id, translationLang: 'en', category: 'x',
})

test('errorIcon: fixed→green check, error→red cross', () => {
  assert.equal(errorIcon('fixed'), '✅')
  assert.equal(errorIcon('error'), '❌')
})

test('reporting always yields error (even from fixed)', () => {
  assert.equal(statusAfterReport(), 'error')
})

test('wordsWithErrors keeps only flagged words, in order, with status', () => {
  const words = [w('a'), w('b'), w('c'), w('d')]
  const errors = { b: 'error' as const, d: 'fixed' as const }
  const rows = wordsWithErrors(words, errors)
  assert.deepEqual(rows.map((r) => r.word.id), ['b', 'd'])
  assert.deepEqual(rows.map((r) => r.status), ['error', 'fixed'])
})

test('wordsWithErrors is empty when nothing is flagged', () => {
  assert.equal(wordsWithErrors([w('a')], {}).length, 0)
})

test('spelling warning shows only while a word is in error status', () => {
  const errors = { a: 'error' as const, b: 'fixed' as const }
  assert.equal(showSpellingWarning(errors, 'a'), true)
  assert.equal(showSpellingWarning(errors, 'b'), false) // fixed → cleared
  assert.equal(showSpellingWarning(errors, 'c'), false) // never reported
  assert.equal(showSpellingWarning({}, 'a'), false)
})
