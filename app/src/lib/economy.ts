import type { CastleItem, CastleItemType, Wallet } from './types.js'

export type RewardKind = 'choice' | 'blank' | 'match' | 'lightning' | 'sound'

const BASE_REWARD: Record<RewardKind, number> = {
  choice: 1,
  blank: 2,
  match: 2, // per matched pair
  lightning: 1, // multiplied by combo
  sound: 2, // per correct sound-match
}

export function answerReward(kind: RewardKind, firstTry: boolean, combo = 1): number {
  const base = kind === 'lightning' ? BASE_REWARD.lightning * combo : BASE_REWARD[kind]
  return base + (firstTry && kind !== 'lightning' ? 1 : 0)
}

export const GRADUATION_BONUS = { coins: 10, bricks: 1 }
export const DAILY_GOAL_MINUTES_DEFAULT = 20

/**
 * Time-bonus tiers: 20 min -> 25, 40 -> 35, 60 -> 50, then +50 per full 20 min.
 * paidUpTo is the highest minute mark already paid; returns newly earned coins.
 */
export function computeTimeBonuses(activeMinutes: number, paidUpTo: number): { coins: number; paidUpTo: number } {
  let coins = 0
  let mark = paidUpTo
  const tierCoins = (minuteMark: number) => (minuteMark === 20 ? 25 : minuteMark === 40 ? 35 : 50)
  for (let m = mark + 20; m <= activeMinutes; m += 20) {
    coins += tierCoins(m)
    mark = m
  }
  return { coins, paidUpTo: mark }
}

export interface ShopEntry {
  coins: number
  bricks: number
  defense: number
  label: string
  emoji: string
}

export const SHOP: Record<CastleItemType, ShopEntry> = {
  land: { coins: 50, bricks: 0, defense: 0, label: 'Land tile', emoji: '🟩' },
  wall: { coins: 30, bricks: 5, defense: 1, label: 'Wall', emoji: '🧱' },
  gate: { coins: 100, bricks: 10, defense: 2, label: 'Gate', emoji: '🚪' },
  tower: { coins: 200, bricks: 20, defense: 3, label: 'Tower', emoji: '🗼' },
  banner: { coins: 40, bricks: 0, defense: 0, label: 'Banner', emoji: '🚩' },
  keep: { coins: 500, bricks: 50, defense: 5, label: 'Keep', emoji: '🏰' },
}

export function canAfford(type: CastleItemType, wallet: Wallet): boolean {
  return wallet.coins >= SHOP[type].coins && wallet.bricks >= SHOP[type].bricks
}

export function canBuild(
  type: CastleItemType,
  wallet: Wallet,
  castle: CastleItem[],
  x: number,
  y: number,
): { ok: boolean; reason: string } {
  if (!canAfford(type, wallet)) return { ok: false, reason: 'Not enough coins or bricks' }
  const cellLand = castle.find((i) => i.type === 'land' && i.x === x && i.y === y)
  const cellBuilding = castle.find((i) => i.type !== 'land' && i.x === x && i.y === y)
  if (type === 'land') {
    if (cellLand) return { ok: false, reason: 'Already land here' }
    return { ok: true, reason: '' }
  }
  if (!cellLand) return { ok: false, reason: 'Needs a land tile first' }
  if (cellBuilding) return { ok: false, reason: 'Cell is occupied' }
  if (type === 'tower' && !castle.some((i) => i.type === 'gate' && i.status === 'built')) {
    return { ok: false, reason: 'Build a gate before towers' }
  }
  if (type === 'keep' && castle.some((i) => i.type === 'keep')) {
    return { ok: false, reason: 'Only one keep' }
  }
  return { ok: true, reason: '' }
}

let itemCounter = 0
export function buildItem(
  type: CastleItemType,
  wallet: Wallet,
  _castle: CastleItem[],
  x: number,
  y: number,
  nowIso: string,
): { wallet: Wallet; item: CastleItem } {
  const price = SHOP[type]
  itemCounter += 1
  return {
    wallet: { coins: wallet.coins - price.coins, bricks: wallet.bricks - price.bricks },
    item: { id: `${type}-${nowIso}-${itemCounter}`, type, x, y, status: 'built', builtAt: nowIso },
  }
}

export function rebuildCost(type: CastleItemType): { coins: number; bricks: number } {
  return { coins: Math.floor(SHOP[type].coins / 2), bricks: 0 }
}

/** The item an attack tears down: latest built, land excluded. */
export function ruinTarget(castle: CastleItem[]): CastleItem | null {
  const candidates = castle.filter((i) => i.status === 'built' && i.type !== 'land')
  if (candidates.length === 0) return null
  return candidates.reduce((a, b) => (a.builtAt > b.builtAt ? a : b))
}
