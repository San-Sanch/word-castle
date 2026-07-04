import type { CastleItem, CastleItemType, Wallet } from './types.js'
import { terrainAt } from './world.js'

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

export interface ShopCost {
  coins: number
  bricks: number
  wood: number
  stone: number
  food: number
}

export interface ShopEntry {
  cost: ShopCost
  defense: number
  label: string
  blurb: string
}

const cost = (c: Partial<ShopCost>): ShopCost => ({ coins: 0, bricks: 0, wood: 0, stone: 0, food: 0, ...c })

export const SHOP: Record<CastleItemType, ShopEntry> = {
  land: { cost: cost({ coins: 15 }), defense: 0, label: 'Clear land', blurb: 'Claims a grass tile and widens your view' },
  road: { cost: cost({ coins: 5 }), defense: 0, label: 'Road', blurb: 'Cheap expansion; everything builds next to your network' },
  bridge: { cost: cost({ coins: 20, wood: 5 }), defense: 0, label: 'Bridge', blurb: 'Crosses a river; enemies can use it too' },
  field: { cost: cost({ coins: 15 }), defense: 0, label: 'Crop field', blurb: 'Grows food to feed your guardians' },
  woodcutter: { cost: cost({ coins: 30 }), defense: 0, label: 'Woodcutter', blurb: 'Build beside a forest; produces wood' },
  quarry: { cost: cost({ coins: 50 }), defense: 0, label: 'Quarry', blurb: 'Build beside mountains; produces stone' },
  wall: { cost: cost({ coins: 10, stone: 2, bricks: 1 }), defense: 1, label: 'Wall', blurb: 'Protects only a fully closed ring with a gate' },
  gate: { cost: cost({ coins: 40, stone: 4, bricks: 3 }), defense: 2, label: 'Gate', blurb: 'Every wall ring needs at least one' },
  tower: { cost: cost({ coins: 80, stone: 8, bricks: 6 }), defense: 3, label: 'Tower', blurb: 'Counts as wall; sees far across the map' },
  banner: { cost: cost({ coins: 20 }), defense: 0, label: 'Banner', blurb: 'Pure pride' },
  keep: { cost: cost({ coins: 200, stone: 20, bricks: 15 }), defense: 5, label: 'Keep', blurb: 'The heart of your castle' },
}

/** Items offered in the build menu (land exists only for old saves). */
export const BUILD_MENU: CastleItemType[] = [
  'road', 'bridge', 'field', 'woodcutter', 'quarry', 'wall', 'gate', 'tower', 'banner', 'keep',
]

export function canAfford(type: CastleItemType, wallet: Wallet): boolean {
  const c = SHOP[type].cost
  return (
    wallet.coins >= c.coins &&
    wallet.bricks >= c.bricks &&
    wallet.wood >= c.wood &&
    wallet.stone >= c.stone &&
    wallet.food >= c.food
  )
}

const neighbors = (x: number, y: number): Array<[number, number]> => [
  [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
]

/** Terrain, occupancy and connectivity rules for placing a new item. */
export function canBuildAt(
  type: CastleItemType,
  x: number,
  y: number,
  wallet: Wallet,
  items: CastleItem[],
): { ok: boolean; reason: string } {
  if (!canAfford(type, wallet)) return { ok: false, reason: 'Not enough resources' }
  if (items.some((i) => i.x === x && i.y === y && i.type !== 'land')) {
    return { ok: false, reason: 'Occupied' }
  }
  const t = terrainAt(x, y)
  if (t === 'mountain') return { ok: false, reason: 'Cannot build on mountains' }
  if (t === 'river' && type !== 'bridge') return { ok: false, reason: 'Only bridges go over water' }
  if (type === 'bridge' && t !== 'river') return { ok: false, reason: 'Bridges only make sense over water' }
  if (type === 'field' && t !== 'grass') return { ok: false, reason: 'Fields need open grassland' }
  if (type === 'land' && t !== 'grass') return { ok: false, reason: 'Only grassland can be cleared' }
  if (type === 'woodcutter' && !neighbors(x, y).some(([nx, ny]) => terrainAt(nx, ny) === 'forest')) {
    return { ok: false, reason: 'Needs an adjacent forest' }
  }
  if (type === 'quarry' && !neighbors(x, y).some(([nx, ny]) => terrainAt(nx, ny) === 'mountain')) {
    return { ok: false, reason: 'Needs adjacent mountains' }
  }
  if (type === 'keep' && items.some((i) => i.type === 'keep')) {
    return { ok: false, reason: 'Only one keep' }
  }
  // connectivity: everything grows from the existing network
  const connected =
    items.length === 0 ||
    items.some((i) => i.status === 'built' && Math.abs(i.x - x) + Math.abs(i.y - y) === 1) ||
    items.some((i) => i.status === 'built' && i.x === x && i.y === y) // building on own cleared land
  if (!connected) return { ok: false, reason: 'Must touch your roads or buildings' }
  return { ok: true, reason: '' }
}

let itemCounter = 0
export function buildItem(
  type: CastleItemType,
  wallet: Wallet,
  x: number,
  y: number,
  nowIso: string,
  tick: number,
): { wallet: Wallet; item: CastleItem } {
  const c = SHOP[type].cost
  itemCounter += 1
  return {
    wallet: {
      coins: wallet.coins - c.coins,
      bricks: wallet.bricks - c.bricks,
      wood: wallet.wood - c.wood,
      stone: wallet.stone - c.stone,
      food: wallet.food - c.food,
    },
    item: { id: `${type}-${nowIso}-${itemCounter}`, type, x, y, status: 'built', builtAt: nowIso, builtTick: tick },
  }
}

export function rebuildCost(type: CastleItemType): { coins: number } {
  return { coins: Math.floor(SHOP[type].cost.coins / 2) }
}

/** The item an attack tears down: latest built among the candidates. */
export function ruinTarget(candidates: CastleItem[]): CastleItem | null {
  const valid = candidates.filter((i) => i.status === 'built' && i.type !== 'land' && i.type !== 'road')
  if (valid.length === 0) return null
  return valid.reduce((a, b) => (a.builtAt > b.builtAt ? a : b))
}
