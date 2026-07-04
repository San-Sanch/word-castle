import type {
  AttackKind,
  AttackResult,
  CastleItem,
  CastleItemType,
  DayLog,
  Guardian,
  ReviewState,
  Settings,
  Wallet,
} from './types.js'
import { DEFAULT_SETTINGS } from './types.js'
import { applyAnswer, isGraduated, newReviewState, shouldActivateRecall } from './srs.js'
import {
  answerReward,
  buildItem,
  canBuild,
  computeTimeBonuses,
  GRADUATION_BONUS,
  rebuildCost,
  ruinTarget,
  type RewardKind,
} from './economy.js'
import { resolveRaid } from './attack.js'
import { missedFullDays } from './time.js'
import { HIRE_COST, levelFromSets } from './guardian.js'

export interface GameState {
  version: 1
  wallet: Wallet
  settings: Settings
  reviews: ReviewState[]
  graduatedIds: string[]
  castle: CastleItem[]
  guardian: Guardian | null
  dayLogs: DayLog[]
  attacks: Array<{
    id: string
    date: string
    kind: AttackKind
    severity: number
    defense: number
    result: AttackResult
    coinsDelta: number
    ruinedItemId: string | null
  }>
  lastRaidCheck: string | null
}

export function initialGameState(): GameState {
  return {
    version: 1,
    wallet: { coins: 0, bricks: 0 },
    settings: DEFAULT_SETTINGS,
    reviews: [],
    graduatedIds: [],
    castle: [],
    guardian: null,
    dayLogs: [],
    attacks: [],
    lastRaidCheck: null,
  }
}

const EMPTY_LOG = (date: string): DayLog => ({
  date,
  cardsAnswered: 0,
  correct: 0,
  mistakes: 0,
  activeSeconds: 0,
  coinsEarned: 0,
  timeBonusPaidUpTo: 0,
  graduated: 0,
})

export function todayLog(state: GameState, today: string): DayLog {
  return state.dayLogs.find((l) => l.date === today) ?? EMPTY_LOG(today)
}

function upsertLog(state: GameState, log: DayLog): GameState {
  const exists = state.dayLogs.some((l) => l.date === log.date)
  return {
    ...state,
    dayLogs: exists ? state.dayLogs.map((l) => (l.date === log.date ? log : l)) : [...state.dayLogs, log],
  }
}

export function introducedTodayCount(state: GameState, today: string): number {
  return state.reviews.filter((r) => r.direction === 'recognition' && r.introducedAt === today).length
}

export function lastActiveDate(state: GameState): string | null {
  const active = state.dayLogs.filter((l) => l.cardsAnswered > 0).map((l) => l.date)
  return active.length ? active.sort()[active.length - 1] : null
}

function addCoins(wallet: Wallet, delta: number): Wallet {
  return { ...wallet, coins: Math.max(0, wallet.coins + delta) }
}

let logCounter = 0

export type GameAction =
  | { type: 'introduce'; wordId: string; today: string }
  | {
      type: 'answer'
      wordId: string
      direction: 'recognition' | 'recall'
      correct: boolean
      firstTry: boolean
      rewardKind: RewardKind
      combo?: number
      today: string
    }
  | { type: 'bonusCoins'; amount: number; today: string }
  | { type: 'activeTime'; seconds: number; today: string }
  | { type: 'build'; itemType: CastleItemType; x: number; y: number; nowIso: string }
  | { type: 'rebuild'; itemId: string }
  | { type: 'hire'; name: string; avatar: string; category: string; nowIso: string }
  | { type: 'trainingCompleted' }
  | {
      type: 'applyAttack'
      kind: AttackKind
      severity: number
      defense: number
      result: AttackResult
      coinsDelta: number
      ruin: boolean
      today: string
    }
  | { type: 'raidCheck'; today: string }
  | { type: 'setSettings'; settings: Settings }
  | { type: 'import'; state: GameState }
  | { type: 'reset' }

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'introduce': {
      if (state.reviews.some((r) => r.wordId === action.wordId && r.direction === 'recognition')) return state
      return {
        ...state,
        reviews: [...state.reviews, newReviewState(action.wordId, 'recognition', action.today)],
      }
    }

    case 'answer': {
      const { wordId, direction, correct, firstTry, rewardKind, combo, today } = action
      const idx = state.reviews.findIndex((r) => r.wordId === wordId && r.direction === direction)
      if (idx === -1) return state
      const updated = applyAnswer(state.reviews[idx], correct, today)
      let reviews = state.reviews.map((r, i) => (i === idx ? updated : r))

      if (
        direction === 'recognition' &&
        shouldActivateRecall(updated, reviews.some((r) => r.wordId === wordId && r.direction === 'recall'))
      ) {
        reviews = [...reviews, newReviewState(wordId, 'recall', today)]
      }

      let coinsDelta = 0
      let graduatedIds = state.graduatedIds
      let graduatedNow = 0
      if (correct) {
        coinsDelta += answerReward(rewardKind, firstTry, combo)
        if (isGraduated(updated) && !graduatedIds.includes(wordId)) {
          graduatedIds = [...graduatedIds, wordId]
          coinsDelta += GRADUATION_BONUS.coins
          graduatedNow = 1
        }
      }

      const log = todayLog(state, today)
      const next = upsertLog(
        {
          ...state,
          reviews,
          graduatedIds,
          wallet: {
            coins: state.wallet.coins + coinsDelta,
            bricks: state.wallet.bricks + graduatedNow * GRADUATION_BONUS.bricks,
          },
        },
        {
          ...log,
          cardsAnswered: log.cardsAnswered + 1,
          correct: log.correct + (correct ? 1 : 0),
          mistakes: log.mistakes + (correct ? 0 : 1),
          coinsEarned: log.coinsEarned + coinsDelta,
          graduated: log.graduated + graduatedNow,
        },
      )
      return next
    }

    case 'bonusCoins': {
      const log = todayLog(state, action.today)
      return upsertLog(
        { ...state, wallet: addCoins(state.wallet, action.amount) },
        { ...log, coinsEarned: log.coinsEarned + action.amount },
      )
    }

    case 'activeTime': {
      const log = todayLog(state, action.today)
      const activeSeconds = log.activeSeconds + action.seconds
      const minutes = Math.floor(activeSeconds / 60)
      const bonus = computeTimeBonuses(minutes, log.timeBonusPaidUpTo)
      return upsertLog(
        { ...state, wallet: addCoins(state.wallet, bonus.coins) },
        {
          ...log,
          activeSeconds,
          timeBonusPaidUpTo: bonus.paidUpTo,
          coinsEarned: log.coinsEarned + bonus.coins,
        },
      )
    }

    case 'build': {
      const { itemType, x, y, nowIso } = action
      if (!canBuild(itemType, state.wallet, state.castle, x, y).ok) return state
      const { wallet, item } = buildItem(itemType, state.wallet, state.castle, x, y, nowIso)
      return { ...state, wallet, castle: [...state.castle, item] }
    }

    case 'rebuild': {
      const item = state.castle.find((i) => i.id === action.itemId)
      if (!item || item.status !== 'ruin') return state
      const cost = rebuildCost(item.type)
      if (state.wallet.coins < cost.coins) return state
      return {
        ...state,
        wallet: addCoins(state.wallet, -cost.coins),
        castle: state.castle.map((i) => (i.id === item.id ? { ...i, status: 'built' as const } : i)),
      }
    }

    case 'hire': {
      if (state.guardian || state.wallet.coins < HIRE_COST) return state
      return {
        ...state,
        wallet: addCoins(state.wallet, -HIRE_COST),
        guardian: {
          name: action.name,
          avatar: action.avatar,
          category: action.category,
          level: 1,
          setsCompleted: 0,
          hiredAt: action.nowIso,
        },
      }
    }

    case 'trainingCompleted': {
      if (!state.guardian) return state
      const setsCompleted = state.guardian.setsCompleted + 1
      return {
        ...state,
        guardian: { ...state.guardian, setsCompleted, level: levelFromSets(setsCompleted) },
      }
    }

    case 'applyAttack': {
      const { kind, severity, defense, result, coinsDelta, ruin, today } = action
      let castle = state.castle
      let ruinedItemId: string | null = null
      if (ruin) {
        const target = ruinTarget(castle)
        if (target) {
          ruinedItemId = target.id
          castle = castle.map((i) => (i.id === target.id ? { ...i, status: 'ruin' as const } : i))
        }
      }
      logCounter += 1
      return {
        ...state,
        wallet: addCoins(state.wallet, coinsDelta),
        castle,
        attacks: [
          ...state.attacks,
          { id: `${kind}-${today}-${logCounter}`, date: today, kind, severity, defense, result, coinsDelta, ruinedItemId },
        ],
      }
    }

    case 'raidCheck': {
      const { today } = action
      if (state.lastRaidCheck === today) return state
      const last = lastActiveDate(state)
      const checked = { ...state, lastRaidCheck: today }
      if (!last) return checked
      const daysMissed = missedFullDays(last, today)
      if (daysMissed === 0) return checked
      const outcome = resolveRaid({
        daysMissed,
        guardianLevel: state.guardian?.level ?? 0,
        coins: state.wallet.coins,
      })
      if (outcome.result === 'defended' && !outcome.ruin) {
        return gameReducer(checked, {
          type: 'applyAttack', kind: 'raid', severity: daysMissed, defense: state.guardian?.level ?? 0,
          result: 'defended', coinsDelta: 0, ruin: false, today,
        })
      }
      return gameReducer(checked, {
        type: 'applyAttack',
        kind: 'raid',
        severity: daysMissed,
        defense: state.guardian?.level ?? 0,
        result: outcome.result,
        coinsDelta: outcome.coinsDelta,
        ruin: outcome.ruin,
        today,
      })
    }

    case 'setSettings':
      return { ...state, settings: action.settings }

    case 'import':
      return action.state

    case 'reset':
      return initialGameState()
  }
}
