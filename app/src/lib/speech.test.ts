import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ttsNormalize, loadVocalized, loadStressOverrides } from './speech.js'

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
  loadVocalized({ full: {}, tokens: { 'איזו': 'אֵיזוֹ', 'אילו': 'אֵילוּ' } })
  assert.equal(ttsNormalize('איזה/איזו/אילו?'), 'איזה, אֵיְזוֹ, אֵיְלוּ?')
  loadVocalized({ full: {}, tokens: {} })
})

test('ttsNormalize: tsere-yud gets the glide shva everywhere', () => {
  loadVocalized({ full: {}, tokens: { 'ביצה': 'בֵּיצָה', 'בית': 'בַּיִת' } })
  // bei-tza: the bare yud after tsere gains a shva glide
  assert.match(ttsNormalize('ביצה'), /\u05D9\u05B0/)
  // ba-yit: yud with its own vowel stays untouched
  assert.doesNotMatch(ttsNormalize('בית'), /\u05D9\u05B0/)
  loadVocalized({ full: {}, tokens: {} })
})

test('stress overrides apply by skeleton, even inside full-sentence matches', () => {
  loadVocalized({ full: { 'יש לי כסף': 'יֵשׁ לִי כֶּסֶף' }, tokens: {} })
  loadStressOverrides({ 'כסף': 'כֶּאסֶף' })
  assert.ok(ttsNormalize('יש לי כסף').includes('כֶּאסֶף')) // KE-sef inside the sentence
  // manual overrides beat stress overrides
  loadStressOverrides({ 'דוד': 'דָּוִד' })
  assert.equal(ttsNormalize('דוד'), 'דּוֹד')
  loadStressOverrides({})
  loadVocalized({ full: {}, tokens: {} })
})

test('ttsNormalize: manual corrections for wrong engine choices', () => {
  assert.equal(ttsNormalize('מכתב'), 'מִכְתָּב') // mikhtav, not machtev
  assert.equal(ttsNormalize('מים'), 'מַיְם') // stressed MA-im (maym glide)
  assert.equal(ttsNormalize('סבא'), 'סַאבָּא') // SA-ba, not sa-BA
  assert.equal(ttsNormalize('סבתא'), 'סַבְּתָא') // SAV-ta
  assert.equal(ttsNormalize('בית'), 'בַּאיִת') // BA-yit
  assert.equal(ttsNormalize('היא באה מהבית'), 'היא באה מֵהַבַּאיִת') // me-ha-BA-yit
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

test('ttsNormalize: flagged-word fixes (2026-07-17 word_errors batch)', () => {
  // phrase override wins over the per-token bayit respelling (bet-, not BA-yit)
  assert.equal(ttsNormalize('בית ספר'), 'בֵּיְת סֵפֶר')
  assert.equal(ttsNormalize('שפה'), 'שָׂפָה') // sa-FA, not Dicta's she-po
  assert.ok(ttsNormalize('ארוחת צוהוריים').includes('צָהֳרַיְם')) // tso-ho-RA-im
  assert.equal(ttsNormalize('היי'), 'הַאי') // hay, one syllable
  assert.equal(ttsNormalize('ו...'), 'וֶה...') // ve
  assert.equal(ttsNormalize('מ'), 'מִ') // mi, not the letter name mem
  assert.equal(ttsNormalize('אנגליה'), 'אַנְגְּלִיאָה') // ang-LI-ya (measured)
  assert.equal(ttsNormalize('מנגו'), 'מַאנְגּוֹ') // MAN-go (measured)
})
