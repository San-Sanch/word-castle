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

/**
 * Extracts base word, gender and plural from entries like "אימא (נ') אימהות".
 * The source CSV writes the marker in several sloppy variants: (ז') (נ") (ז) (זי),
 * a mistyped closing paren (ז'( and a combined (ז'/נ') for both-gender nouns.
 */
export function parseHebrewEntry(raw: string): { hebrew: string; gender: Gender; plural: string | null } {
  const both = raw.match(/\(ז['"׳״י]?\/נ['"׳״י]?\)/)
  const single = both ? null : raw.match(/\((ז|נ)['"׳״י]?[)(]/)
  const m = both ?? single
  if (!m || m.index === undefined) {
    return { hebrew: raw.trim(), gender: null, plural: null }
  }
  const hebrew = raw.slice(0, m.index).trim()
  const after = raw.slice(m.index + m[0].length).trim()
  return {
    hebrew,
    gender: both ? null : single![1] === 'ז' ? 'm' : 'f',
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

/** Ids of rows dropped by `dedupeWords`, mapped to the row that replaced them. */
export type MergedIds = Record<string, string>

/** Meaning parts of a translation, normalized: "sorry / excuse me" -> {sorry, excuse me}. */
export function meaningParts(translation: string): string[] {
  return translation
    .toLowerCase()
    .split(/[/,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** How much lexical detail a row carries — the richest row of a duplicate group wins. */
function richness(w: Word): number {
  return (w.plural ? 2 : 0) + (w.gender ? 1 : 0)
}

/**
 * Collapses rows that describe the same base word. The source CSV grew by merging
 * several documents, so the same word often appears both as a curated entry
 * ("אבא (ז')אבות") and as a bare one from a later import ("אבא") — three times for
 * בית. Left alone they become separate cards with the same Hebrew prompt, which is
 * unanswerable in multiple choice and double-counts progress.
 *
 * The survivor is the richest row (plural/gender), tie-broken by the category the
 * group agrees on, then by row order. Its id is left untouched so saved progress
 * still matches; `merged` maps every dropped id to its survivor so progress on the
 * dropped twin can be folded in. Meanings are unioned ("dad" + "father" ->
 * "dad / father"); a group whose meanings don't overlap at all is reported, since
 * that is the signature of an actual homograph that needs splitting by hand.
 */
export function dedupeWords(words: Word[]): {
  words: Word[]
  merged: Record<string, string>
  suspicious: Array<{ hebrew: string; meanings: string[] }>
} {
  const groups = new Map<string, Word[]>()
  for (const w of words) {
    if (!groups.has(w.hebrew)) groups.set(w.hebrew, [])
    groups.get(w.hebrew)!.push(w)
  }

  const merged: Record<string, string> = {}
  const suspicious: Array<{ hebrew: string; meanings: string[] }> = []
  const survivors = new Map<string, Word>() // id -> the row to emit

  for (const group of groups.values()) {
    if (group.length === 1) {
      survivors.set(group[0].id, group[0])
      continue
    }
    const catCount = new Map<string, number>()
    for (const w of group) catCount.set(w.category, (catCount.get(w.category) ?? 0) + 1)
    const best = Math.max(...group.map(richness))
    const winner = group
      .filter((w) => richness(w) === best)
      .sort((a, b) => (catCount.get(b.category) ?? 0) - (catCount.get(a.category) ?? 0))[0]

    // Only same-language glosses are comparable: the CSV mixes curated Ukrainian
    // rows with English ones from later imports, and the English overrides are
    // applied further down the pipeline.
    const sameLang = group.filter((w) => w.translationLang === winner.translationLang)
    const parts: string[] = []
    for (const w of sameLang) {
      for (const p of meaningParts(w.translation)) if (!parts.includes(p)) parts.push(p)
    }
    // no shared meaning between two glosses of the same language = probably homographs
    const shares = sameLang.some((a) =>
      sameLang.some((b) => a !== b && meaningParts(a.translation).some((p) => meaningParts(b.translation).includes(p))),
    )
    if (sameLang.length > 1 && !shares) {
      suspicious.push({ hebrew: winner.hebrew, meanings: sameLang.map((w) => w.translation) })
    }

    survivors.set(winner.id, {
      ...winner,
      translation: parts.length > 1 ? parts.join(' / ') : winner.translation,
    })
    for (const w of group) if (w.id !== winner.id) merged[w.id] = winner.id
  }

  // keep the original row order
  const kept = words.map((w) => survivors.get(w.id)).filter((w): w is Word => w !== undefined)
  return { words: kept, merged, suspicious }
}

/**
 * Turns raw CSV rows (header included) into Word entities.
 * Rows in the "Sentences" category are returned separately for the sentence pool.
 * Identical duplicate rows are all kept here (source data is authoritative) with
 * distinct ids; collapsing same-word rows is `dedupeWords`, a separate step so the
 * pipeline can report what it merged.
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
  // dictionary-style variant entries ("מה קרה/מה קורה") are two sentences,
  // not one: split hebrew and translation pairwise when the counts match
  const expanded: SentenceRow[] = []
  for (const c of candidates) {
    if (c.hebrew.includes('/')) {
      const heParts = c.hebrew.split('/').map((s) => s.trim()).filter(Boolean)
      const trParts = c.translation.split('/').map((s) => s.trim()).filter(Boolean)
      if (heParts.length > 1 && heParts.length === trParts.length) {
        heParts.forEach((he, i) => expanded.push({ hebrew: he, translation: trParts[i] }))
        continue
      }
      continue // unsplittable slash entries are not usable as sentences
    }
    expanded.push(c)
  }

  const out: Sentence[] = []
  const seen = new Set<string>()
  for (const c of expanded) {
    const hebrew = c.hebrew.trim()
    if (seen.has(hebrew)) continue
    const segments = hebrew.split(',').map((s) => tokenize(s))
    const totalTokens = segments.reduce((n, s) => n + s.length, 0)
    const hasRealSegment = segments.some((s) => s.length >= 2)
    if (totalTokens < 2 || !hasRealSegment) continue
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
