import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ttsNormalize } from './speech.js'

test('ttsNormalize: drops parenthesized hints', () => {
  assert.equal(ttsNormalize('עובד/עובדת (ב)'), 'עובד, עובדת')
  assert.equal(ttsNormalize('רואה (את)'), 'רואה')
  assert.equal(ttsNormalize('מדבר/מדברת (עם/על/ב)'), 'מדבר, מדברת')
})

test('ttsNormalize: slash forms become a comma pause', () => {
  assert.equal(ttsNormalize('זה/זאת/אלה'), 'זה, זאת, אלה')
  assert.equal(ttsNormalize('נכון/לא נכון'), 'נכון, לא נכון')
})

test('ttsNormalize: plain words untouched, whitespace collapsed', () => {
  assert.equal(ttsNormalize('שלום'), 'שלום')
  assert.equal(ttsNormalize('  ארוחת   בוקר '), 'ארוחת בוקר')
})

test('ttsNormalize: ambiguous words get vowelized so the voice reads them right', () => {
  assert.equal(ttsNormalize('דוד'), 'דּוֹד') // uncle, not the name David
  assert.equal(ttsNormalize('דוד, דודה'), 'דּוֹד, דּוֹדָה')
  assert.equal(ttsNormalize('דוד שלי'), 'דּוֹד שלי')
})
