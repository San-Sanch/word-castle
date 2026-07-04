// Regenerates src/data/words.json and src/data/sentences.json from the source CSVs.
// Run: npm run data   (compiles src/lib first, then executes this script)
// Source CSVs are read-only inputs and never modified.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv, buildWords, buildSentencePool } from '../.test-build/dataParse.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

const wordsCsv = readFileSync(join(repoRoot, 'hebrew_words.csv'), 'utf8')
const sentencesCsv = readFileSync(join(repoRoot, 'source-data', 'hebrew_sentences.csv'), 'utf8')

const { words, sentenceRows } = buildWords(parseCsv(wordsCsv))

// English overrides for rows whose CSV translation is Ukrainian (translated from
// the Hebrew side, which also corrects the one-row translation shift in the
// Food & Drinks block of the source CSV). CSV itself stays untouched.
const overrides = JSON.parse(readFileSync(join(here, '..', 'src', 'data', 'translation-overrides.json'), 'utf8'))
let overridden = 0
for (const w of words) {
  const en = overrides[w.id]
  if (en) {
    w.translationUa = w.translation
    w.translation = en
    w.translationLang = 'en'
    overridden++
  }
}
const remainingUa = words.filter((w) => w.translationLang === 'ua').length

// hebrew_sentences.csv: Date,Hebrew,English Translation
const extraRows = parseCsv(sentencesCsv)
  .slice(1)
  .filter((r) => r.length >= 3 && r[1])
  .map((r) => ({ hebrew: r[1], translation: r[2] }))

const sentences = buildSentencePool([...sentenceRows, ...extraRows], words)

const outDir = join(here, '..', 'src', 'data')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'words.json'), JSON.stringify(words, null, 1))
writeFileSync(join(outDir, 'sentences.json'), JSON.stringify(sentences, null, 1))

const matched = sentences.filter((s) => s.matches.length > 0).length
console.log(`words: ${words.length}`)
console.log(`english overrides applied: ${overridden}, words still ua: ${remainingUa}`)
console.log(`sentences kept: ${sentences.length} (of ${sentenceRows.length + extraRows.length} candidates)`)
console.log(`sentences with >=1 matched word: ${matched}`)
console.log(`categories: ${new Set(words.map((w) => w.category)).size}`)
