// Systematic stress fixer. Carmit defaults to final stress (milra); words with
// penultimate stress (mil'el) — segolates, Aramaic loans — come out wrong.
// Sanch's own transliterations mark the stressed syllable in CAPS, so:
//   1. find every word whose stressed syllable is NOT the last,
//   2. build a candidate respelling (mater-lectionis aleph after the stressed
//      vowel — measured to flip stress for saba/bayit),
//   3. render plain vs candidate with the actual system voice (say -v Carmit)
//      and MEASURE syllable weight; accept only candidates that move it.
// Output: src/data/stress-overrides.json  (token -> respelled vocalized form)
// Requires macOS `say` + `afconvert` and the Carmit voice. Run after
// transliterate.mjs. Idempotent; safe to re-run.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'src', 'data')

const words = JSON.parse(readFileSync(join(dataDir, 'words.json'), 'utf8'))
const translit = JSON.parse(readFileSync(join(dataDir, 'translit.json'), 'utf8'))
const vocalized = JSON.parse(readFileSync(join(dataDir, 'vocalized.json'), 'utf8'))
const sentences = JSON.parse(readFileSync(join(dataDir, 'sentences.json'), 'utf8'))
const stories = JSON.parse(readFileSync(join(dataDir, 'stories.json'), 'utf8'))

const clean = (t) =>
  t.replace(/\([^)]*\)/g, ' ').replace(/\s*\/\s*/g, ', ').replace(/\s+/g, ' ').replace(/\s*,\s*$/g, '').trim()

// ---------- stress position from Sanch's CAPS transliterations ----------

/** returns stressed syllable index FROM THE END (1 = last), or null */
function stressFromEnd(tr) {
  const parts = tr.split('-')
  if (parts.length < 2) return null
  const idx = parts.findIndex((p) => /[A-Z]{2,}/.test(p))
  if (idx === -1) return null
  return parts.length - idx
}

// ---------- candidate builder: aleph after the Nth-from-end vowel ----------

const VOWEL_MARKS = 'ְֱֲֳִֵֶַָֹֺֻ'
function vowelPositions(voc) {
  const pos = []
  const chars = [...voc]
  for (let i = 0; i < chars.length; i++) {
    if (VOWEL_MARKS.includes(chars[i]) && chars[i] !== 'ְ') pos.push(i)
    // shuruk: dagesh on a vav that carries no vowel of its own
    if (chars[i] === 'ּ' && chars[i - 1] === 'ו') {
      const prevIsVowel = pos.length && pos[pos.length - 1] >= i - 3
      if (!prevIsVowel) pos.push(i)
    }
  }
  return { chars, pos }
}

function buildCandidate(voc, fromEnd) {
  const { chars, pos } = vowelPositions(voc)
  if (pos.length < fromEnd) return null
  const at = pos[pos.length - fromEnd]
  // mater-lectionis aleph right after the stressed vowel mark
  return [...chars.slice(0, at + 1), 'א', ...chars.slice(at + 1)].join('')
}

// ---------- audio measurement (same rig as the manual fixes) ----------

const tmp = mkdtempSync(join(tmpdir(), 'stress-'))
let renderCount = 0

function render(text) {
  const base = join(tmp, `r${renderCount++}`)
  execFileSync('say', ['-v', 'Carmit', '-o', `${base}.aiff`, text])
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', `${base}.aiff`, `${base}.wav`])
  return `${base}.wav`
}

function headShare(wavPath) {
  const buf = readFileSync(wavPath)
  const dataIdx = buf.indexOf(Buffer.from('data')) + 8
  const samples = []
  for (let i = dataIdx; i + 1 < buf.length; i += 2) samples.push(buf.readInt16LE(i))
  const win = Math.max(1, Math.floor(samples.length / 80))
  const prof = []
  for (let i = 0; i + win < samples.length; i += win) {
    let s = 0
    for (let j = i; j < i + win; j++) s += samples[j] * samples[j]
    prof.push(Math.sqrt(s / win))
  }
  const peak = Math.max(...prof) || 1
  const voiced = prof.map((v, i) => [v, i]).filter(([v]) => v > peak * 0.1).map(([, i]) => i)
  if (voiced.length < 4) return null
  const a = voiced[0]
  const b = voiced[voiced.length - 1]
  const seg = prof.slice(a, b + 1)
  const lo = Math.floor(seg.length * 0.2)
  const hi = Math.floor(seg.length * 0.8)
  let valley = lo
  for (let i = lo; i < hi; i++) if (seg[i] < seg[valley]) valley = i
  return valley / seg.length // share of duration before the valley
}

// ---------- main loop ----------

const results = {}
const report = { accepted: [], rejected: [], identical: [], skippedPhrase: 0, skippedNoNikud: 0, milra: 0 }

for (const w of words) {
  const tr = translit[w.id]?.he
  if (!tr) continue
  const fromEnd = stressFromEnd(tr)
  if (!fromEnd || fromEnd === 1) {
    report.milra++
    continue
  }
  const base = clean(w.hebrew).replace(/[?.!:;,]/g, '')
  if (base.includes(' ') || base.includes(',')) {
    report.skippedPhrase++
    continue
  }
  if (results[base]) continue
  const voc = vocalized.tokens[base] ?? vocalized.full[base]
  if (!voc) {
    report.skippedNoNikud++
    continue
  }
  const cand = buildCandidate(voc, fromEnd)
  if (!cand) {
    report.skippedNoNikud++
    continue
  }
  try {
    const plainWav = render(voc)
    const candWav = render(cand)
    const plainBuf = readFileSync(plainWav)
    const candBuf = readFileSync(candWav)
    if (plainBuf.equals(candBuf)) {
      report.identical.push(base)
      continue
    }
    const hp = headShare(plainWav)
    const hc = headShare(candWav)
    if (hp !== null && hc !== null && hc > hp + 0.08) {
      results[base] = cand
      report.accepted.push(`${base} (${tr}): ${hp.toFixed(2)} -> ${hc.toFixed(2)}`)
    } else {
      report.rejected.push(`${base} (${tr}): ${hp?.toFixed(2)} -> ${hc?.toFixed(2)}`)
    }
  } catch (e) {
    report.rejected.push(`${base}: render error ${e.message}`)
  }
}

// ---------- extend to prefixed corpus tokens (validated via their base) ----------

const corpusTokens = new Set()
const addTokens = (text) =>
  clean(text).replace(/[,?.!:;]/g, '').split(/\s+/).forEach((t) => t && corpusTokens.add(t))
for (const s of sentences) addTokens(s.hebrew)
for (const st of stories) {
  addTokens(st.title_he)
  for (const s of st.sentences) addTokens(s.he)
  for (const q of st.questions) {
    addTokens(q.he)
    for (const o of q.options) addTokens(o)
  }
}
let prefixed = 0
for (const token of corpusTokens) {
  if (results[token]) continue
  for (const base of Object.keys(results)) {
    if (token !== base && token.endsWith(base) && token.length - base.length <= 2) {
      const vocTok = vocalized.tokens[token]
      if (!vocTok) continue
      const trBase = translit[words.find((w) => clean(w.hebrew) === base)?.id]?.he
      const fromEnd = trBase ? stressFromEnd(trBase) : null
      if (!fromEnd) continue
      const cand = buildCandidate(vocTok, fromEnd)
      if (cand) {
        results[token] = cand
        prefixed++
      }
      break
    }
  }
}

rmSync(tmp, { recursive: true, force: true })
writeFileSync(join(dataDir, 'stress-overrides.json'), JSON.stringify(results, null, 1))
console.log(`mil'el words found: ${report.accepted.length + report.rejected.length + report.identical.length}`)
console.log(`accepted (measured better): ${report.accepted.length}`)
console.log(`rejected (no measurable gain): ${report.rejected.length}`)
console.log(`identical rendering (engine normalizes): ${report.identical.length}`)
console.log(`prefixed corpus forms added: ${prefixed}`)
console.log(`skipped: ${report.skippedPhrase} phrases, ${report.skippedNoNikud} without nikud; milra (already fine): ${report.milra}`)
console.log('\nSAMPLE accepted:')
for (const line of report.accepted.slice(0, 15)) console.log(' ', line)
console.log('\nSAMPLE rejected:')
for (const line of report.rejected.slice(0, 8)) console.log(' ', line)
