import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ttsNormalize, loadVocalized } from './speech.js'

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

test('ttsNormalize: tokens with trailing punctuation still get vocalized', () => {
  loadVocalized({ full: {}, tokens: { 'איזו': 'אֵיזוֹ' } })
  assert.equal(ttsNormalize('איזה/איזו/אילו?'), 'איזה, אֵיזוֹ, אֵיְלוּ?')
  loadVocalized({ full: {}, tokens: {} })
})

test('ttsNormalize: generated vocalization applies (full phrase first, tokens as fallback)', () => {
  loadVocalized({
    full: { 'ארוחת בוקר': 'אֲרוּחַת בּוֹקֶר' },
    tokens: { 'ארוחת': 'אֲרוּחַת', 'לחם': 'לֶחֶם' },
  })
  assert.equal(ttsNormalize('ארוחת בוקר'), 'אֲרוּחַת בּוֹקֶר')
  assert.equal(ttsNormalize('לחם טרי'), 'לֶחֶם טרי') // token fallback
  // manual overrides beat the generated data
  loadVocalized({ full: { 'דוד': 'דָּוִד' }, tokens: { 'דוד': 'דָּוִד' } })
  assert.equal(ttsNormalize('דוד'), 'דּוֹד')
  loadVocalized({ full: {}, tokens: {} })
})
