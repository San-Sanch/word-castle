export type Gender = 'm' | 'f' | null
export type TranslationLang = 'ua' | 'en'
export type Direction = 'recognition' | 'recall'

export interface Word {
  id: string
  hebrew: string
  hebrewFull: string
  gender: Gender
  plural: string | null
  translation: string
  translationLang: TranslationLang
  /** original Ukrainian translation from the CSV when the shown one is an English override */
  translationUa?: string
  category: string
}

export interface Sentence {
  id: string
  hebrew: string
  translation: string
  /** tokenIndex -> wordId for tokens that match a known word */
  matches: Array<{ tokenIndex: number; wordId: string }>
  tokens: string[]
}

export interface ReviewState {
  wordId: string
  direction: Direction
  box: number // 0..7
  dueAt: string // YYYY-MM-DD
  lapses: number
  streak: number
  introducedAt: string // YYYY-MM-DD
}

export interface Wallet {
  coins: number
  bricks: number
}

export type CastleItemType = 'land' | 'wall' | 'gate' | 'tower' | 'banner' | 'keep'
export type CastleItemStatus = 'built' | 'ruin'

export interface CastleItem {
  id: string
  type: CastleItemType
  x: number
  y: number
  status: CastleItemStatus
  builtAt: string // ISO datetime, used for latest-upgrade targeting
}

export interface Guardian {
  name: string
  avatar: string
  category: string
  level: number // 1..10
  setsCompleted: number
  hiredAt: string
}

export interface Settings {
  newWordsPerDay: number
  dailyGoalMinutes: number
  sessionSize: number
  attackChancePct: number
  exercises: {
    choice: boolean
    blank: boolean
    match: boolean
    lightning: boolean
    sound: boolean
  }
}

export const DEFAULT_SETTINGS: Settings = {
  newWordsPerDay: 10,
  dailyGoalMinutes: 20,
  sessionSize: 25,
  attackChancePct: 15,
  exercises: { choice: true, blank: true, match: true, lightning: true, sound: true },
}

export interface DayLog {
  date: string // YYYY-MM-DD
  cardsAnswered: number
  correct: number
  mistakes: number
  activeSeconds: number
  coinsEarned: number
  /** highest time-bonus tier minute mark already paid out (0, 20, 40, 60, 80...) */
  timeBonusPaidUpTo: number
  graduated: number
}

export type AttackKind = 'session' | 'raid'
export type AttackResult = 'win' | 'coin-loss' | 'ruin' | 'defended'

export interface AttackLog {
  id: string
  date: string
  kind: AttackKind
  severity: number
  defense: number
  result: AttackResult
  coinsDelta: number
  ruinedItemId: string | null
}
