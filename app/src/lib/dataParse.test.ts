import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv,
  parseHebrewEntry,
  buildWords,
  buildSentencePool,
  matchWordsInSentence,
} from './dataParse.js'

// --- CSV parsing (fixtures are verbatim rows from hebrew_words.csv / hebrew_sentences.csv) ---

test('parseCsv: plain rows', () => {
  const rows = parseCsv('Hebrew,Ukrainian,Category,Occurrences\nאימא (נ\') אימהות,мати,Family,1\n')
  assert.deepEqual(rows[1], ["אימא (נ') אימהות", 'мати', 'Family', '1'])
})

test('parseCsv: quoted field with commas and escaped quotes', () => {
  const rows = parseCsv('"משפחה (נ"") משפחות",родина,Family,1\n"זה יין, זה הר","This is wine, this is a mountain",Sentences,0\n')
  assert.deepEqual(rows[0], ['משפחה (נ") משפחות', 'родина', 'Family', '1'])
  assert.deepEqual(rows[1], ['זה יין, זה הר', 'This is wine, this is a mountain', 'Sentences', '0'])
})

// --- Hebrew entry parsing: gender markers and plurals ---

test('parseHebrewEntry: feminine with spaced plural', () => {
  assert.deepEqual(parseHebrewEntry("אימא (נ') אימהות"), {
    hebrew: 'אימא', gender: 'f', plural: 'אימהות',
  })
})

test('parseHebrewEntry: masculine with unspaced plural', () => {
  assert.deepEqual(parseHebrewEntry("אבא (ז')אבות"), {
    hebrew: 'אבא', gender: 'm', plural: 'אבות',
  })
})

test('parseHebrewEntry: gershayim gender marker', () => {
  assert.deepEqual(parseHebrewEntry('משפחה (נ") משפחות'), {
    hebrew: 'משפחה', gender: 'f', plural: 'משפחות',
  })
})

test('parseHebrewEntry: no marker', () => {
  assert.deepEqual(parseHebrewEntry('לדבר'), { hebrew: 'לדבר', gender: null, plural: null })
})

test('parseHebrewEntry: marker without plural', () => {
  assert.deepEqual(parseHebrewEntry("יין (ז')"), { hebrew: 'יין', gender: 'm', plural: null })
})

// --- Word building from CSV rows ---

test('buildWords: detects translation language, skips Sentences category', () => {
  const rows: string[][] = [
    ['Hebrew', 'Ukrainian', 'Category', 'Occurrences'],
    ["אימא (נ') אימהות", 'мати', 'Family', '1'],
    ['לדבר', 'to speak', 'Verbs', '0'],
    ['זה יין, זה הר', 'This is wine, this is a mountain', 'Sentences', '0'],
  ]
  const { words, sentenceRows } = buildWords(rows)
  assert.equal(words.length, 2)
  assert.equal(words[0].hebrew, 'אימא')
  assert.equal(words[0].translationLang, 'ua')
  assert.equal(words[0].gender, 'f')
  assert.equal(words[1].translationLang, 'en')
  assert.equal(sentenceRows.length, 1)
  assert.equal(sentenceRows[0].hebrew, 'זה יין, זה הר')
})

test('buildWords: identical duplicate rows both kept with distinct ids', () => {
  const rows: string[][] = [
    ['h', 'u', 'c', 'o'],
    ['שלום', 'привіт', 'Politeness', '1'],
    ['שלום', 'привіт', 'Politeness', '1'],
  ]
  const { words } = buildWords(rows)
  assert.equal(words.length, 2)
  assert.notEqual(words[0].id, words[1].id)
})

// --- Sentence pool ---

test('buildSentencePool: keeps real sentences, drops letter lists and single-word lists', () => {
  const candidates = [
    { hebrew: 'א', translation: 'Alef (letter)' },
    { hebrew: 'ג, ד, ל, ר', translation: 'Gimel, Dalet, Lamed, Resh (letters)' },
    { hebrew: 'לומד, עובד, אוהב, הולך', translation: 'study, work, love, walk' },
    { hebrew: 'אני לומד עברית.', translation: 'I study Hebrew. (m.)' },
    { hebrew: 'זה יין, זה הר, זאת מתנה', translation: 'This is wine, this is a mountain, this is a gift' },
    { hebrew: 'אני לומד עברית.', translation: 'I study Hebrew. (m.)' }, // exact duplicate
  ]
  const pool = buildSentencePool(candidates, [])
  const texts = pool.map((s: { hebrew: string }) => s.hebrew)
  assert.deepEqual(texts, ['אני לומד עברית.', 'זה יין, זה הר, זאת מתנה'])
})

test('matchWordsInSentence: exact token and prefixed token match single-token words only', () => {
  const words = [
    { id: 'w1', hebrew: 'עברית' },
    { id: 'w2', hebrew: 'יין' },
    { id: 'w3', hebrew: 'ארוחת בוקר' }, // multi-token: never matched
  ]
  const m1 = matchWordsInSentence('אני לומד עברית.', words)
  assert.deepEqual(m1.matches, [{ tokenIndex: 2, wordId: 'w1' }])
  assert.deepEqual(m1.tokens, ['אני', 'לומד', 'עברית'])
  // ו/ה/ב/ל/מ/ש prefix: היין matches יין
  const m2 = matchWordsInSentence('זה היין שלי', words)
  assert.deepEqual(m2.matches, [{ tokenIndex: 1, wordId: 'w2' }])
})
