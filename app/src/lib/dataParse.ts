import type { Gender, Sentence, TranslationLang, Word } from './types.js'

/** RFC-4180-ish CSV parser: handles quoted fields, embedded commas, "" escapes, \r\n. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows
}

/** Extracts base word, gender and plural from entries like "אימא (נ') אימהות". */
export function parseHebrewEntry(raw: string): { hebrew: string; gender: Gender; plural: string | null } {
  // gender marker: (ז') / (נ') with geresh, gershayim or plain apostrophe/quote
  const m = raw.match(/\((ז|נ)['"׳״]\)/)
  if (!m || m.index === undefined) {
    return { hebrew: raw.trim(), gender: null, plural: null }
  }
  const hebrew = raw.slice(0, m.index).trim()
  const after = raw.slice(m.index + m[0].length).trim()
  return {
    hebrew,
    gender: m[1] === 'ז' ? 'm' : 'f',
    plural: after || null,
  }
}

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

const CYRILLIC = /[Ѐ-ӿ]/

export interface SentenceRow {
  hebrew: string
  translation: string
}

/**
 * Turns raw CSV rows (header included) into Word entities.
 * Rows in the "Sentences" category are returned separately for the sentence pool.
 * Identical duplicate rows are all kept (source data is authoritative) with distinct ids.
 */
export function buildWords(rows: string[][]): { words: Word[]; sentenceRows: SentenceRow[] } {
  const words: Word[] = []
  const sentenceRows: SentenceRow[] = []
  const seen = new Map<string, number>()
  for (const r of rows.slice(1)) {
    if (r.length < 3 || !r[0]) continue
    const [hebrewFull, translation, category] = r
    if (category === 'Sentences') {
      sentenceRows.push({ hebrew: hebrewFull, translation })
      continue
    }
    const { hebrew, gender, plural } = parseHebrewEntry(hebrewFull)
    const key = `${hebrewFull}|${translation}|${category}`
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    const lang: TranslationLang = CYRILLIC.test(translation) ? 'ua' : 'en'
    words.push({
      id: count === 1 ? djb2(key) : `${djb2(key)}#${count}`,
      hebrew,
      hebrewFull,
      gender,
      plural,
      translation,
      translationLang: lang,
      category,
    })
  }
  return { words, sentenceRows }
}

const HEBREW_PREFIXES = ['ה', 'ו', 'ב', 'ל', 'מ', 'ש']

function tokenize(hebrew: string): string[] {
  return hebrew
    .replace(/[.,!?:;"׳״()־]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Finds which known words appear in a sentence. Only single-token words participate. */
export function matchWordsInSentence(
  sentenceHebrew: string,
  words: Array<{ id: string; hebrew: string }>,
): Pick<Sentence, 'matches' | 'tokens'> {
  const tokens = tokenize(sentenceHebrew)
  const byToken = new Map<string, string>()
  for (const w of words) {
    if (w.hebrew.includes(' ')) continue
    if (!byToken.has(w.hebrew)) byToken.set(w.hebrew, w.id)
  }
  const matches: Array<{ tokenIndex: number; wordId: string }> = []
  tokens.forEach((tok, tokenIndex) => {
    let wordId = byToken.get(tok)
    if (!wordId && tok.length > 1 && HEBREW_PREFIXES.includes(tok[0])) {
      wordId = byToken.get(tok.slice(1))
    }
    if (wordId) matches.push({ tokenIndex, wordId })
  })
  return { matches, tokens }
}

/**
 * Builds the sentence pool for fill-the-blank.
 * Keeps only real sentences: at least 3 tokens total and at least one
 * comma-separated segment with 2+ tokens (drops letter lists and word lists).
 * Exact-duplicate Hebrew texts are collapsed (derived pool, source untouched).
 */
export function buildSentencePool(
  candidates: SentenceRow[],
  words: Array<{ id: string; hebrew: string }>,
): Sentence[] {
  const out: Sentence[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    const hebrew = c.hebrew.trim()
    if (seen.has(hebrew)) continue
    const segments = hebrew.split(',').map((s) => tokenize(s))
    const totalTokens = segments.reduce((n, s) => n + s.length, 0)
    const hasRealSegment = segments.some((s) => s.length >= 2)
    if (totalTokens < 3 || !hasRealSegment) continue
    seen.add(hebrew)
    const { matches, tokens } = matchWordsInSentence(hebrew, words)
    out.push({
      id: djb2(hebrew),
      hebrew,
      translation: c.translation,
      matches,
      tokens,
    })
  }
  return out
}
