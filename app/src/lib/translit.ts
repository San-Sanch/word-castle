// Rule-based romanization of VOCALIZED Hebrew (text with nikud).
// Produces readable syllable-hyphenated Latin like "sha-lom", "ta-pu-akh".
// Not a linguistic authority — good enough to read a word out loud.

const DAGESH = 'ּ'
const SHIN_DOT = 'ׁ'
const SIN_DOT = 'ׂ'

// vowel marks -> latin vowel ('' = shva/none)
const VOWELS: Record<string, string> = {
  'ְ': '', // shva
  'ֱ': 'e', // hataf segol
  'ֲ': 'a', // hataf patah
  'ֳ': 'o', // hataf qamats
  'ִ': 'i', // hiriq
  'ֵ': 'e', // tsere
  'ֶ': 'e', // segol
  'ַ': 'a', // patah
  'ָ': 'a', // qamats
  'ֹ': 'o', // holam
  'ֺ': 'o', // holam haser for vav
  'ֻ': 'u', // qubuts
}

interface Piece {
  cons: string
  vowel: string
}

function consonantOf(letter: string, dagesh: boolean, shin: boolean, sin: boolean): string {
  switch (letter) {
    case 'א': case 'ע': return ''
    case 'ב': return dagesh ? 'b' : 'v'
    case 'ג': return 'g'
    case 'ד': return 'd'
    case 'ה': return 'h'
    case 'ו': return 'v'
    case 'ז': return 'z'
    case 'ח': return 'kh'
    case 'ט': return 't'
    case 'י': return 'y'
    case 'כ': return dagesh ? 'k' : 'kh'
    case 'ך': return 'kh'
    case 'ל': return 'l'
    case 'מ': case 'ם': return 'm'
    case 'נ': case 'ן': return 'n'
    case 'ס': return 's'
    case 'פ': return dagesh ? 'p' : 'f'
    case 'ף': return 'f'
    case 'צ': case 'ץ': return 'tz'
    case 'ק': return 'k'
    case 'ר': return 'r'
    case 'ש': return sin ? 's' : shin ? 'sh' : 'sh'
    case 'ת': return 't'
    default: return ''
  }
}

function romanizeWord(word: string): string {
  // parse into letter+marks groups
  const groups: Array<{ letter: string; marks: string[] }> = []
  for (const ch of word) {
    if (/[א-ת]/.test(ch)) groups.push({ letter: ch, marks: [] })
    else if (groups.length) groups[groups.length - 1].marks.push(ch)
  }
  if (groups.length === 0) return ''

  const pieces: Piece[] = []
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const dagesh = g.marks.includes(DAGESH)
    const shin = g.marks.includes(SHIN_DOT)
    const sin = g.marks.includes(SIN_DOT)
    const vowelMark = g.marks.find((m) => m in VOWELS)
    let vowel = vowelMark ? VOWELS[vowelMark] : ''
    const last = i === groups.length - 1

    // vav as vowel carrier: shuruk (וּ with no own vowel) and holam male (וֹ)
    if (g.letter === 'ו' && !vowelMark && dagesh) {
      if (pieces.length && pieces[pieces.length - 1].vowel === '') {
        pieces[pieces.length - 1].vowel = 'u'
        continue
      }
      pieces.push({ cons: '', vowel: 'u' })
      continue
    }
    if (g.letter === 'ו' && g.marks.includes('ֹ')) {
      if (pieces.length && pieces[pieces.length - 1].vowel === '') {
        pieces[pieces.length - 1].vowel = 'o'
        continue
      }
      pieces.push({ cons: '', vowel: 'o' })
      continue
    }
    // yud as part of hiriq/tsere male: absorbed into the previous vowel
    if (g.letter === 'י' && !vowelMark && !dagesh && pieces.length && /[ie]/.test(pieces[pieces.length - 1].vowel)) {
      continue
    }
    // silent final he
    if (last && g.letter === 'ה' && !dagesh && !vowelMark) continue

    // furtive patach: final ח/ע with patach is read BEFORE the consonant
    if (last && vowelMark === 'ַ' && (g.letter === 'ח' || g.letter === 'ע')) {
      pieces.push({ cons: '', vowel: 'a' })
      pieces.push({ cons: g.letter === 'ח' ? 'kh' : '', vowel: '' })
      continue
    }

    pieces.push({ cons: consonantOf(g.letter, dagesh, shin, sin), vowel })
  }

  // assemble syllables: consonant(s) + vowel; vowel-less pieces glue to the
  // syllable being built (onset cluster) or, at word end, to the previous one
  const syllables: string[] = []
  let current = ''
  for (const p of pieces) {
    current += p.cons
    if (p.vowel) {
      syllables.push(current + p.vowel)
      current = ''
    }
  }
  if (current) {
    if (syllables.length) syllables[syllables.length - 1] += current
    else syllables.push(current)
  }
  return syllables.filter(Boolean).join('-')
}

/** Romanize a vocalized Hebrew string; words separated by spaces/commas keep their separators. */
export function hebrewToLatin(text: string): string {
  return text
    .split(/(\s+|,)/)
    .map((part) => (/[א-ת]/.test(part) ? romanizeWord(part) : part))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
