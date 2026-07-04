// One-time generator for src/data/vocalized.json: nikud for every word, plural
// and sentence via the Dicta Nakdan API (context-aware), overlaid with the
// verified nikud from source-data/hebrew_vocabulary_categorized.csv.
// Run: node scripts/vocalize.mjs   (needs internet; results are committed)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../.test-build/dataParse.js'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'src', 'data')
const repoRoot = join(here, '..', '..', '..')

const words = JSON.parse(readFileSync(join(dataDir, 'words.json'), 'utf8'))
const sentences = JSON.parse(readFileSync(join(dataDir, 'sentences.json'), 'utf8'))

const NIKUD = /[֑-ׇ]/g
const strip = (s) => s.replace(NIKUD, '')
const HEBREW = /[א-ת]/

// mirror of ttsNormalize's cleanup (keep in sync with src/lib/speech.ts)
const clean = (text) =>
  text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s*\/\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*$/g, '')
    .trim()

// --- collect every speakable unit ---
const units = new Set()
for (const w of words) {
  units.add(clean(w.hebrew))
  if (w.plural) units.add(clean(w.plural))
}
for (const s of sentences) units.add(clean(s.hebrew))
const list = [...units].filter((u) => u && HEBREW.test(u))
console.log('speakable units:', list.length)

// --- Dicta Nakdan, batched ---
async function nakdan(text) {
  const res = await fetch('https://nakdan-2-0.loadbalancer.dicta.org.il/api', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      task: 'nakdan', genre: 'modern', data: text,
      addmorph: false, keepqq: false, nodageshdefmem: false, patachma: false, keepmetagim: false,
    }),
  })
  if (!res.ok) throw new Error(`nakdan HTTP ${res.status}`)
  return res.json()
}

const BATCH = 40
const full = new Map() // cleaned full string -> vocalized
const tokens = new Map() // token -> vocalized token (first writer wins)

for (let i = 0; i < list.length; i += BATCH) {
  const batch = list.slice(i, i + BATCH)
  const payload = batch.join('\n')
  let parts
  for (let attempt = 1; ; attempt++) {
    try {
      parts = await nakdan(payload)
      break
    } catch (e) {
      if (attempt >= 3) throw e
      console.log(`retry ${attempt} after error: ${e.message}`)
      await new Promise((r) => setTimeout(r, 2500 * attempt))
    }
  }
  // rebuild lines from the token stream
  let line = ''
  const lines = []
  for (const p of parts) {
    if (p.sep && p.word.includes('\n')) {
      lines.push(line)
      line = ''
    } else {
      // Dicta marks morpheme boundaries with '|'; not part of the text
      line += (p.sep ? p.word : (p.options[0] ?? p.word)).replace(/\|/g, '')
    }
  }
  lines.push(line)
  if (lines.length !== batch.length) {
    throw new Error(`line mismatch: sent ${batch.length}, got ${lines.length} (batch at ${i})`)
  }
  batch.forEach((src, j) => {
    const voc = lines[j].trim()
    if (strip(voc) !== src) {
      console.log(`skeleton mismatch, skipping: "${src}" -> "${voc}"`)
      return
    }
    if (voc !== src) full.set(src, voc)
    const depunct = (s) => s.replace(/[,?.!:;]/g, '')
    const srcTokens = depunct(src).split(/\s+/).filter(Boolean)
    const vocTokens = depunct(voc).split(/\s+/).filter(Boolean)
    if (srcTokens.length === vocTokens.length) {
      srcTokens.forEach((t, k) => {
        if (t !== vocTokens[k] && !tokens.has(t)) tokens.set(t, vocTokens[k])
      })
    }
  })
  console.log(`vocalized ${Math.min(i + BATCH, list.length)}/${list.length}`)
  await new Promise((r) => setTimeout(r, 600))
}

// --- overlay: Sanch's own vocabulary file has human-provided nikud ---
const catCsv = parseCsv(readFileSync(join(repoRoot, 'source-data', 'hebrew_vocabulary_categorized.csv'), 'utf8'))
let overlay = 0
for (const row of catCsv.slice(1)) {
  const voc = (row[1] ?? '').trim()
  if (!voc || !NIKUD.test(voc)) continue
  const skeleton = strip(voc)
  if (skeleton === voc) continue
  if (units.has(skeleton)) {
    full.set(skeleton, voc)
    overlay++
  }
  for (const [t, vt] of skeleton.split(/\s+/).map((t, i) => [t, voc.split(/\s+/)[i]])) {
    if (t && vt && strip(vt) === t && t !== vt) tokens.set(t, vt)
  }
}
console.log(`overlay from categorized CSV: ${overlay} full entries`)

const out = { full: Object.fromEntries(full), tokens: Object.fromEntries(tokens) }
writeFileSync(join(dataDir, 'vocalized.json'), JSON.stringify(out, null, 1))
console.log(`written: ${full.size} full entries, ${tokens.size} token entries`)
console.log('spot checks:', JSON.stringify({
  'דוד': out.tokens['דוד'] ?? out.full['דוד'],
  'ארוחת בוקר': out.full['ארוחת בוקר'],
  'עובד, עובדת': out.full['עובד, עובדת'],
}))
