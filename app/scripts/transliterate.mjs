// Generates src/data/translit.json: Latin transcription for every word.
// Priority: hand-written transliterations from source-data/
// hebrew_vocabulary_categorized.csv, then rule-based romanization of the
// vocalized forms (vocalized.json). Run after vocalize.mjs / npm run data.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../.test-build/dataParse.js'
import { hebrewToLatin } from '../.test-build/translit.js'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'src', 'data')
const repoRoot = join(here, '..', '..', '..')

const words = JSON.parse(readFileSync(join(dataDir, 'words.json'), 'utf8'))
const vocalized = JSON.parse(readFileSync(join(dataDir, 'vocalized.json'), 'utf8'))

const NIKUD = /[֑-ׇ]/g
const strip = (s) => s.replace(NIKUD, '')
const clean = (t) =>
  t.replace(/\([^)]*\)/g, ' ').replace(/\s*\/\s*/g, ', ').replace(/\s+/g, ' ').replace(/\s*,\s*$/g, '').trim()

// hand-written transliterations from Sanch's vocabulary file, keyed by skeleton
const manual = new Map()
const catCsv = parseCsv(readFileSync(join(repoRoot, 'source-data', 'hebrew_vocabulary_categorized.csv'), 'utf8'))
for (const row of catCsv.slice(1)) {
  const he = (row[1] ?? '').trim()
  const tr = (row[3] ?? '').trim()
  if (he && tr) manual.set(strip(he), tr)
}

const vocalize = (text) => {
  const c = clean(text)
  if (vocalized.full[c]) return vocalized.full[c]
  return c
    .split(' ')
    .map((tok) => {
      const m = tok.match(/^(.*?)(,?)$/)
      return (vocalized.tokens[m[1]] ?? m[1]) + m[2]
    })
    .join(' ')
}

const out = {}
let fromManual = 0
let generated = 0
for (const w of words) {
  const key = clean(w.hebrew)
  let tr = manual.get(key)
  if (tr) fromManual++
  else {
    tr = hebrewToLatin(vocalize(w.hebrew))
    generated++
  }
  const entry = { he: tr }
  if (w.plural) {
    entry.plural = manual.get(clean(w.plural)) ?? hebrewToLatin(vocalize(w.plural))
  }
  if (entry.he) out[w.id] = entry
}

writeFileSync(join(dataDir, 'translit.json'), JSON.stringify(out, null, 1))
console.log(`translit.json: ${Object.keys(out).length} entries (${fromManual} hand-written, ${generated} generated)`)
console.log('samples:', JSON.stringify(Object.fromEntries(words.slice(0, 3).map((w) => [w.hebrew, out[w.id]?.he]))))
const uncle = words.find((w) => w.hebrew === 'דוד')
const breakfast = words.find((w) => w.hebrew === 'ארוחת בוקר')
console.log('uncle:', out[uncle?.id]?.he, '| breakfast:', out[breakfast?.id]?.he)