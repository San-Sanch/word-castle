import type { Direction, Sentence, Word } from './types.js'

/** Deterministic RNG for testability. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface ChoiceExercise {
  kind: 'choice'
  wordId: string
  direction: Direction
  prompt: string
  options: string[]
  correctIndex: number
}

const tokenCount = (s: string) => s.trim().split(/\s+/).length

/**
 * Wrong options must not give themselves away by shape: a single-word answer
 * gets single-word distractors; phrases get similar-length phrases (±1 token).
 */
function shapeCompatible(answer: string, candidate: string): boolean {
  const a = tokenCount(answer)
  const c = tokenCount(candidate)
  return a === 1 ? c === 1 : Math.abs(a - c) <= 1
}

/**
 * Distractor preference: same category + shape, then same shape, then anything.
 * Better fewer options than conspicuous ones: shape is only broken when there
 * are not even 3 believable distractors.
 */
export function makeChoice(
  word: Word,
  direction: Direction,
  pool: Word[],
  rng: () => number,
  count = 8,
): ChoiceExercise {
  const answer = direction === 'recognition' ? word.translation : word.hebrew
  const textOf = (w: Word) => (direction === 'recognition' ? w.translation : w.hebrew)
  const candidates = pool.filter((w) => w.id !== word.id && textOf(w) !== answer)
  const inShape = candidates.filter((w) => shapeCompatible(answer, textOf(w)))
  const tiers = [
    inShape.filter((w) => w.category === word.category && w.translationLang === word.translationLang),
    inShape.filter((w) => w.translationLang === word.translationLang),
    inShape,
  ]
  const picked: string[] = []
  for (const tier of tiers) {
    for (const w of shuffle(tier, rng)) {
      const text = textOf(w)
      if (picked.length >= count - 1) break
      if (!picked.includes(text)) picked.push(text)
    }
    if (picked.length >= count - 1) break
  }
  // always fill to the full count: pad with the least conspicuous remaining
  // words — closest token count first, then closest length
  if (picked.length < count - 1) {
    const rest = candidates
      .map((w) => textOf(w))
      .filter((text) => !picked.includes(text))
      .map((text) => ({
        text,
        key: Math.abs(tokenCount(text) - tokenCount(answer)) * 1000 + Math.abs(text.length - answer.length) * 10 + rng(),
      }))
      .sort((a, b) => a.key - b.key)
    for (const r of rest) {
      if (picked.length >= count - 1) break
      picked.push(r.text)
    }
  }
  const options = shuffle([answer, ...picked], rng)
  return {
    kind: 'choice',
    wordId: word.id,
    direction,
    prompt: direction === 'recognition' ? word.hebrew : word.translation,
    options,
    correctIndex: options.indexOf(answer),
  }
}

export interface BlankExercise {
  kind: 'blank'
  sentenceId: string
  wordId: string
  tokens: string[]
  blankIndex: number
  options: string[]
  correctIndex: number
  translation: string
}

export function makeBlank(
  sentence: Sentence,
  match: { tokenIndex: number; wordId: string },
  words: Word[],
  rng: () => number,
  count = 8,
): BlankExercise {
  const target = words.find((w) => w.id === match.wordId)
  if (!target) throw new Error(`word ${match.wordId} not in pool`)
  const distractors = words.filter(
    (w) => w.id !== target.id && !w.hebrew.includes(' ') && w.hebrew !== target.hebrew,
  )
  const sameCat = distractors.filter((w) => w.category === target.category)
  const picked: string[] = []
  for (const tier of [sameCat, distractors]) {
    for (const w of shuffle(tier, rng)) {
      if (picked.length >= count - 1) break
      if (!picked.includes(w.hebrew)) picked.push(w.hebrew)
    }
    if (picked.length >= count - 1) break
  }
  const options = shuffle([target.hebrew, ...picked], rng)
  return {
    kind: 'blank',
    sentenceId: sentence.id,
    wordId: target.id,
    tokens: sentence.tokens,
    blankIndex: match.tokenIndex,
    options,
    correctIndex: options.indexOf(target.hebrew),
    translation: sentence.translation,
  }
}

export interface MatchExercise {
  kind: 'match'
  pairs: Array<{ wordId: string; hebrew: string; translation: string }>
  leftOrder: number[]
  rightOrder: number[]
}

export function makeMatch(words: Word[], rng: () => number): MatchExercise {
  const pairs = words.map((w) => ({ wordId: w.id, hebrew: w.hebrew, translation: w.translation }))
  const idx = pairs.map((_, i) => i)
  return { kind: 'match', pairs, leftOrder: shuffle(idx, rng), rightOrder: shuffle(idx, rng) }
}

export interface SoundExercise {
  kind: 'sound'
  wordId: string
  hebrew: string
  options: string[]
  correctIndex: number
}

/** Rough phonetic-ish similarity for Hebrew strings: shared prefix, length, letter-bigram overlap. */
export function hebrewSimilarity(a: string, b: string): number {
  let prefix = 0
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++
  const bigrams = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const ba = bigrams(a)
  const bb = bigrams(b)
  let shared = 0
  for (const g of ba) if (bb.has(g)) shared++
  const overlap = shared / Math.max(1, Math.max(ba.size, bb.size))
  const lengthCloseness = 1 - Math.min(1, Math.abs(a.length - b.length) / Math.max(a.length, b.length))
  return prefix * 2 + overlap * 3 + lengthCloseness
}

/** Hear the word, pick it among similar-looking/sounding Hebrew words (8 options). */
export function makeSoundMatch(word: Word, pool: Word[], rng: () => number, count = 8): SoundExercise {
  // slash entries are dictionary variant lists, not hearable words
  const base = pool.filter((w) => w.id !== word.id && w.hebrew !== word.hebrew && !w.hebrew.includes('/'))
  const inShape = base.filter((w) => shapeCompatible(word.hebrew, w.hebrew))
  const ranked = (list: Word[]) =>
    list
      .map((w) => ({ w, score: hebrewSimilarity(word.hebrew, w.hebrew) }))
      .sort((a, b) => b.score - a.score)
  const picked: string[] = []
  for (const source of [ranked(inShape).slice(0, count * 2 + 4), ranked(base)]) {
    for (const { w } of shuffle(source, rng)) {
      if (picked.length >= count - 1) break
      if (!picked.includes(w.hebrew)) picked.push(w.hebrew)
    }
    if (picked.length >= count - 1) break
  }
  const options = shuffle([word.hebrew, ...picked], rng)
  return {
    kind: 'sound',
    wordId: word.id,
    hebrew: word.hebrew,
    options,
    correctIndex: options.indexOf(word.hebrew),
  }
}

// ---------- find the original: near-miss spelling distractors ----------

const FINAL_TO_REGULAR: Record<string, string> = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' }
const REGULAR_TO_FINAL: Record<string, string> = { 'מ': 'ם', 'נ': 'ן', 'צ': 'ץ', 'פ': 'ף', 'כ': 'ך' }

/** visually/phonetically confusable Hebrew letters */
const SIMILAR_LETTERS: Record<string, string[]> = {
  'ב': ['כ', 'נ', 'פ'],
  'כ': ['ב', 'נ', 'פ'],
  'נ': ['ב', 'כ', 'ג'],
  'ג': ['נ', 'צ'],
  'ח': ['ה', 'ת'],
  'ה': ['ח', 'ת'],
  'ת': ['ח', 'ה'],
  'ד': ['ר'],
  'ר': ['ד'],
  'ו': ['י', 'ז', 'ן'],
  'י': ['ו', 'ז'],
  'ז': ['ו', 'י'],
  'ס': ['ם', 'ט'],
  'ט': ['ס', 'מ'],
  'מ': ['ט', 'ס'],
  'ע': ['א', 'צ'],
  'א': ['ע'],
  'צ': ['ע', 'ג'],
  'ש': ['ט'],
  'ל': ['ך'],
  'ק': ['ר', 'ה'],
  'פ': ['ב', 'כ'],
}
const ALEF_BET = 'אבגדהוזחטיכלמנסעפצקרשת'

// Latin-script confusables (English/Spanish and any structurally similar
// language reuse this one scheme). Keys are lowercase base letters.
const LATIN_SIMILAR: Record<string, string[]> = {
  a: ['e', 'o', 'i'], e: ['a', 'i', 'o'], i: ['e', 'y', 'l'], o: ['a', 'u', 'e'],
  u: ['o', 'a'], y: ['i', 'e'], b: ['d', 'p'], d: ['b', 'p'], p: ['b', 'q', 'd'],
  q: ['p', 'g'], c: ['k', 's'], k: ['c', 'q'], s: ['c', 'z'], z: ['s'], g: ['j', 'q'],
  j: ['g', 'i'], m: ['n'], n: ['m', 'r'], r: ['n'], t: ['d', 'f'], f: ['t', 'v'],
  v: ['f', 'w', 'b'], w: ['v', 'u'], l: ['i', 't'], h: ['n'], x: ['s', 'c'],
}
const LATIN_ALPHABET = [...'abcdefghijklmnopqrstuvwxyz']

/** Per-script config so spelling-distractor generation works in any alphabet. */
export interface MutationScheme {
  isLetter: (c: string) => boolean
  similar: Record<string, string[]>
  alphabet: string[]
  finalToRegular: Record<string, string>
  regularToFinal: Record<string, string>
}
export const HEBREW_SCHEME: MutationScheme = {
  isLetter: (c) => /[א-ת]/.test(c),
  similar: SIMILAR_LETTERS,
  alphabet: [...ALEF_BET],
  finalToRegular: FINAL_TO_REGULAR,
  regularToFinal: REGULAR_TO_FINAL,
}
export const LATIN_SCHEME: MutationScheme = {
  isLetter: (c) => /[a-zà-öø-ÿ]/i.test(c),
  similar: LATIN_SIMILAR,
  alphabet: LATIN_ALPHABET,
  finalToRegular: {},
  regularToFinal: {},
}

/** normalize final letters (Hebrew): regular forms inside, final forms at word ends */
function fixFinals(text: string, scheme: MutationScheme): string {
  if (Object.keys(scheme.regularToFinal).length === 0) return text
  return text
    .split(' ')
    .map((word) => {
      const chars = [...word].map((ch, i, arr) => {
        const isLast = i === arr.length - 1
        if (!isLast && scheme.finalToRegular[ch]) return scheme.finalToRegular[ch]
        if (isLast && scheme.regularToFinal[ch]) return scheme.regularToFinal[ch]
        return ch
      })
      return chars.join('')
    })
    .join(' ')
}

function mutateOnce(word: string, rng: () => number, scheme: MutationScheme): string {
  const chars = [...word]
  const letterIdxs = chars.map((c, i) => (scheme.isLetter(c) ? i : -1)).filter((i) => i >= 0)
  if (letterIdxs.length < 2) return word
  const keepCase = (src: string, out: string) =>
    src === src.toUpperCase() && src !== src.toLowerCase() ? out.toUpperCase() : out
  const op = Math.floor(rng() * 4)
  const at = letterIdxs[Math.floor(rng() * letterIdxs.length)]
  const regular = (scheme.finalToRegular[chars[at]] ?? chars[at]).toLowerCase()
  if (op === 0 || op === 3) {
    // substitute with a confusable letter
    const cands = scheme.similar[regular] ?? []
    const pick = cands.length ? cands[Math.floor(rng() * cands.length)] : scheme.alphabet[Math.floor(rng() * scheme.alphabet.length)]
    if (pick === regular) return word
    chars[at] = keepCase(chars[at], pick)
  } else if (op === 1) {
    // swap adjacent letters
    const pos = letterIdxs.findIndex((i) => i === at)
    const next = letterIdxs[pos + 1] ?? letterIdxs[pos - 1]
    if (next === undefined || chars[at] === chars[next]) return word
    ;[chars[at], chars[next]] = [chars[next], chars[at]]
  } else {
    // insert a confusable letter next to an existing one
    const cands = scheme.similar[regular] ?? [regular]
    chars.splice(at + 1, 0, cands[Math.floor(rng() * cands.length)])
  }
  return fixFinals(chars.join(''), scheme)
}

/**
 * Prompt is the meaning, options are the term spelled the real way plus
 * near-misses that differ by 1-2 letters. Trains exact spelling recognition.
 * The scheme picks the alphabet, so it works for Hebrew, Latin, etc.
 */
export function makeFindOriginal(
  word: Word,
  rng: () => number,
  count = 8,
  scheme: MutationScheme = HEBREW_SCHEME,
): ChoiceExercise {
  const original = word.hebrew
  const distractors = new Set<string>()
  for (let attempt = 0; attempt < 200 && distractors.size < count - 1; attempt++) {
    let mutated = mutateOnce(original, rng, scheme)
    if (rng() < 0.35) mutated = mutateOnce(mutated, rng, scheme)
    mutated = fixFinals(mutated, scheme)
    if (mutated !== original && !distractors.has(mutated) && [...mutated].some(scheme.isLetter)) {
      distractors.add(mutated)
    }
  }
  const options = shuffle([original, ...distractors], rng)
  return {
    kind: 'choice',
    wordId: word.id,
    direction: 'recall',
    prompt: word.translation,
    options,
    correctIndex: options.indexOf(original),
  }
}

export interface SentenceChoiceExercise {
  kind: 'sentchoice'
  sentenceId: string
  prompt: string
  options: string[]
  correctIndex: number
  /** true when the prompt is Hebrew and options are translations */
  reverse: boolean
}

/** Show a sentence in one language, pick its counterpart among similar-length sentences. */
export function makeSentenceChoice(
  sentence: Sentence,
  pool: Sentence[],
  rng: () => number,
  reverse = false,
  count = 8,
): SentenceChoiceExercise {
  const answer = reverse ? sentence.translation : sentence.hebrew
  const textOf = (s: Sentence) => (reverse ? s.translation : s.hebrew)
  const answerTokens = sentence.tokens.length
  const ranked = pool
    .filter((s) => s.id !== sentence.id && textOf(s) !== answer)
    .map((s) => ({
      text: textOf(s),
      key: Math.abs(s.tokens.length - answerTokens) * 100 + Math.abs(textOf(s).length - answer.length) + rng() * 10,
    }))
    .sort((a, b) => a.key - b.key)
  const picked: string[] = []
  for (const r of ranked) {
    if (picked.length >= count - 1) break
    if (!picked.includes(r.text)) picked.push(r.text)
  }
  const options = shuffle([answer, ...picked], rng)
  return {
    kind: 'sentchoice',
    sentenceId: sentence.id,
    prompt: reverse ? sentence.hebrew : sentence.translation,
    options,
    correctIndex: options.indexOf(answer),
    reverse,
  }
}

export type ExerciseKind = 'choice' | 'blank'

/** Blank appears for somewhat-known words (box>=2) with a sentence, ~40% of the time. */
export function pickExerciseKind(args: {
  box: number
  hasSentence: boolean
  settings: { choice: boolean; blank: boolean }
  roll: number
}): ExerciseKind {
  const { box, hasSentence, settings, roll } = args
  if (settings.blank && hasSentence && box >= 2 && roll < 0.4) return 'blank'
  return 'choice'
}

/** How long to keep the answered card on screen. Audio exercises hold 3s so the
 * revealed word/transcription/translation can be read; others advance fast. */
export function answerDelayMs(audio: boolean, correct: boolean): number {
  if (audio) return 3000
  return correct ? 650 : 1500
}
