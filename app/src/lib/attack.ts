import type { AttackResult, CastleItem } from './types.js'
import { SHOP } from './economy.js'

export function castleDefense(castle: CastleItem[]): number {
  return castle
    .filter((i) => i.status === 'built')
    .reduce((sum, i) => sum + SHOP[i.type].defense, 0)
}

export function rollSeverity(rng: () => number): number {
  return 1 + Math.floor(rng() * 10)
}

/** Correct answers needed in the 60s lightning battle. */
export function lightningTarget(severity: number, defense: number): number {
  return Math.max(5, severity * 3 - defense)
}

export interface SessionAttackOutcome {
  result: AttackResult
  coinsDelta: number
  ruin: boolean
}

export function resolveSessionAttack(args: {
  target: number
  correct: number
  coins: number
  rng: () => number
}): SessionAttackOutcome {
  const { target, correct, coins, rng } = args
  if (correct >= target) {
    return { result: 'win', coinsDelta: 20 + Math.floor(rng() * 31), ruin: false }
  }
  if (correct >= Math.ceil(target / 2)) {
    return { result: 'coin-loss', coinsDelta: -Math.min(50, Math.floor(coins * 0.1)), ruin: false }
  }
  return { result: 'ruin', coinsDelta: 0, ruin: true }
}

export interface RaidOutcome {
  result: AttackResult
  coinsDelta: number
  ruin: boolean
}

/** Overnight raid after missed days. Guardian level 10 fully prevents coin loss; level 8+ prevents ruin. */
export function resolveRaid(args: { daysMissed: number; guardianLevel: number; coins: number }): RaidOutcome {
  const { daysMissed, guardianLevel, coins } = args
  const pct = Math.max(0, 10 - guardianLevel)
  const loss = Math.floor((coins * pct) / 100)
  const coinsDelta = loss === 0 ? 0 : -loss
  const ruin = daysMissed >= 2 && guardianLevel < 8
  return {
    result: ruin ? 'ruin' : coinsDelta < 0 ? 'coin-loss' : 'defended',
    coinsDelta,
    ruin,
  }
}
