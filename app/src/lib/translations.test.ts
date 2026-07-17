import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translationParts } from './translations.js'

test('no-split courses (Hebrew): comma phrases stay whole', () => {
  assert.deepEqual(translationParts('the bill, please', false), ['the bill, please'])
  assert.deepEqual(translationParts("I'd like a menu, please", false), ["I'd like a menu, please"])
  assert.deepEqual(translationParts('dad', false), ['dad'])
})

test('split courses (Duolingo): commas separate meanings', () => {
  assert.deepEqual(translationParts('заздрість, позаздрять, заздрити', true), [
    'заздрість',
    'позаздрять',
    'заздрити',
  ])
  assert.deepEqual(translationParts('dad', true), ['dad'])
})

test('split trims and drops empty parts', () => {
  assert.deepEqual(translationParts('a,  b, ', true), ['a', 'b'])
  assert.deepEqual(translationParts('usually, normally', true), ['usually', 'normally'])
})
