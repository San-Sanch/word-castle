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

/** Distractor preference: same category + same translation language, then same language, then any. */
export function makeChoice(word: Word, direction: Direction, pool: Word[], rng: () => number): ChoiceExercise {
  const answer = direction === 'recognition' ? word.translation : word.hebrew
  const textOf = (w: Word) => (direction === 'recognition' ? w.translation : w.hebrew)
  const candidates = pool.filter((w) => w.id !== word.id && textOf(w) !== answer)
  const tiers = [
    candidates.filter((w) => w.category === word.category && w.translationLang === word.translationLang),
    candidates.filter((w) => w.translationLang === word.translationLang),
    candidates,
  ]
  const picked: string[] = []
  for (const tier of tiers) {
    for (const w of shuffle(tier, rng)) {
      const text = textOf(w)
      if (picked.length >= 3) break
      if (!picked.includes(text)) picked.push(text)
    }
    if (picked.length >= 3) break
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
): BlankExercise {
  const target = words.find((w) => w.id === match.wordId)
  if (!target) throw new Error(`word ${match.wordId} not in pool`)
  const distractors = words.filter(
    (w) => w.id !== target.id && !w.hebrew.includes(' ') && w.hebrew !== target.hebrew,
  )
  const sameCat = distractors.filter((w) => w.category === target.category)
  const picked: string[] = []
  for (const w of shuffle(sameCat.length >= 3 ? sameCat : distractors, rng)) {
    if (picked.length >= 3) break
    if (!picked.includes(w.hebrew)) picked.push(w.hebrew)
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

/** Hear the word, pick it among 6 similar-looking/sounding Hebrew words. */
export function makeSoundMatch(word: Word, pool: Word[], rng: () => number): SoundExercise {
  const candidates = pool
    .filter((w) => w.id !== word.id && w.hebrew !== word.hebrew)
    .map((w) => ({ w, score: hebrewSimilarity(word.hebrew, w.hebrew) }))
    .sort((a, b) => b.score - a.score)
  const topPool = candidates.slice(0, 12)
  const picked: string[] = []
  for (const { w } of shuffle(topPool, rng)) {
    if (picked.length >= 5) break
    if (!picked.includes(w.hebrew)) picked.push(w.hebrew)
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
