import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hebrewToLatin } from './translit.js'

test('hebrewToLatin: everyday words', () => {
  assert.equal(hebrewToLatin('שָׁלוֹם'), 'sha-lom')
  assert.equal(hebrewToLatin('דּוֹד'), 'dod')
  assert.equal(hebrewToLatin('מַיִם'), 'ma-yim')
  assert.equal(hebrewToLatin('בּוֹקֶר'), 'bo-ker')
  assert.equal(hebrewToLatin('עוֹבֶדֶת'), 'o-ve-det')
})

test('hebrewToLatin: bgdkpt letters follow the dagesh', () => {
  assert.equal(hebrewToLatin('בַּיִת'), 'ba-yit')
  assert.equal(hebrewToLatin('אָבִיב'), 'a-viv')
  assert.equal(hebrewToLatin('כֶּלֶב'), 'ke-lev')
  assert.equal(hebrewToLatin('סֵפֶר'), 'se-fer')
})

test('hebrewToLatin: furtive patach and gutturals', () => {
  assert.equal(hebrewToLatin('תַּפּוּחַ'), 'ta-pu-akh')
  assert.equal(hebrewToLatin('רוּחַ'), 'ru-akh')
})

test('hebrewToLatin: shin vs sin, tsadi, final letters', () => {
  assert.equal(hebrewToLatin('שֵׁשׁ'), 'shesh')
  assert.equal(hebrewToLatin('עֵץ'), 'etz')
  assert.equal(hebrewToLatin('אֶרֶץ'), 'e-retz')
})

test('hebrewToLatin: silent final he, initial shva', () => {
  assert.equal(hebrewToLatin('שָׁנָה'), 'sha-na')
  assert.equal(hebrewToLatin('שְׁנַיִם'), 'shna-yim')
})

test('hebrewToLatin: phrases and comma-separated forms', () => {
  assert.equal(hebrewToLatin('אֲרוּחַת בּוֹקֶר'), 'a-ru-khat bo-ker')
  assert.equal(hebrewToLatin('עוֹבֵד, עוֹבֶדֶת'), 'o-ved, o-ve-det')
})
