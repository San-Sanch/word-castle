// The world: deterministic infinite terrain, fog of war, resource production,
// wandering enemy camps and treasure. The world only advances when the player
// answers exercise cards (one tick per answered card) — learning drives time.
import type { Camp, CastleItem, Terrain } from './types.js'
import type { GameState } from './game.js'

export const WORLD_SEED = 20260704

// homeland: always grass so the starting castle area is buildable
const HOME_MIN = -2
const HOME_MAX = 9

// ---------- deterministic noise ----------

function hash2(x: number, y: number, seed: number): number {
  let h = seed ^ (x * 374761393) ^ (y * 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

function fbm(x: number, y: number, seed: number): number {
  return 0.6 * valueNoise(x * 0.09, y * 0.09, seed) + 0.3 * valueNoise(x * 0.21, y * 0.21, seed + 7) + 0.1 * valueNoise(x * 0.47, y * 0.47, seed + 13)
}

export function terrainAt(x: number, y: number): Terrain {
  if (x >= HOME_MIN && x <= HOME_MAX && y >= HOME_MIN && y <= HOME_MAX) return 'grass'
  const river = fbm(x, y, WORLD_SEED + 1)
  if (Math.abs(river - 0.5) < 0.016 + 0.012 * valueNoise(x * 0.05, y * 0.05, WORLD_SEED + 9)) return 'river'
  if (fbm(x, y, WORLD_SEED + 2) > 0.66) return 'mountain'
  if (fbm(x, y, WORLD_SEED + 3) > 0.6) return 'forest'
  return 'grass'
}

// ---------- treasure ----------

export const HEBREW_LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת'.split('')

export function hasChestAt(x: number, y: number): boolean {
  if (x >= HOME_MIN && x <= HOME_MAX && y >= HOME_MIN && y <= HOME_MAX) return false
  return terrainAt(x, y) === 'grass' && hash2(x, y, WORLD_SEED + 77) > 0.988
}

export function chestReward(x: number, y: number): { coins: number; letter: string | null } {
  const h = hash2(x, y, WORLD_SEED + 78)
  const dist = Math.abs(x) + Math.abs(y)
  if (h > 0.6) {
    // a letter of the alef-bet as a collectible
    return { coins: 0, letter: HEBREW_LETTERS[Math.floor(hash2(x, y, WORLD_SEED + 79) * HEBREW_LETTERS.length)] }
  }
  return { coins: 20 + Math.min(180, Math.floor(dist * 2.5)) + Math.floor(h * 40), letter: null }
}

// ---------- vision / fog of war ----------

const VISION_RADIUS: Partial<Record<CastleItem['type'], number>> = {
  tower: 5,
  keep: 4,
  road: 2,
  land: 3,
}
const DEFAULT_VISION = 3

export function visionSet(items: CastleItem[]): Set<string> {
  const v = new Set<string>()
  for (const i of items) {
    const r = VISION_RADIUS[i.type] ?? DEFAULT_VISION
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= r) v.add(`${i.x + dx},${i.y + dy}`)
      }
    }
  }
  return v
}

export function isVisible(x: number, y: number, vision: Set<string>): boolean {
  return vision.has(`${x},${y}`)
}

// ---------- production ----------

export const PRODUCTION: Record<'field' | 'woodcutter' | 'quarry', { every: number; resource: 'food' | 'wood' | 'stone' }> = {
  woodcutter: { every: 15, resource: 'wood' },
  quarry: { every: 18, resource: 'stone' },
  field: { every: 20, resource: 'food' },
}

// ---------- enemy camps ----------

export const CAMP_SPAWN_EVERY = 140
export const CAMP_MOVE_EVERY = 5
export const MAX_CAMPS = 3

export function enemyPassable(x: number, y: number, items: CastleItem[]): boolean {
  const t = terrainAt(x, y)
  if (t === 'mountain') return false
  if (t === 'river') return items.some((i) => i.type === 'bridge' && i.status === 'built' && i.x === x && i.y === y)
  return true
}

function nearestItem(items: CastleItem[], x: number, y: number): CastleItem | null {
  let best: CastleItem | null = null
  let bestD = Infinity
  for (const i of items) {
    const d = Math.abs(i.x - x) + Math.abs(i.y - y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function siegingCamp(camps: Camp[], items: CastleItem[]): Camp | null {
  for (const c of camps) {
    if (items.some((i) => Math.abs(i.x - c.x) + Math.abs(i.y - c.y) <= 1)) return c
  }
  return null
}

function spawnCamp(state: GameState): Camp | null {
  if (state.camps.length >= MAX_CAMPS || state.castle.length === 0) return null
  const target = state.castle[0]
  // pick a deterministic direction + distance from the tick
  const angle = hash2(state.tick, 1, WORLD_SEED + 40) * Math.PI * 2
  const dist = 14 + Math.floor(hash2(state.tick, 2, WORLD_SEED + 41) * 6)
  let x = target.x + Math.round(Math.cos(angle) * dist)
  let y = target.y + Math.round(Math.sin(angle) * dist)
  // slide to a passable tile nearby
  for (let tries = 0; tries < 25; tries++) {
    if (enemyPassable(x, y, state.castle)) {
      return {
        id: `camp-${state.tick}`,
        x,
        y,
        strength: Math.min(10, 3 + Math.floor(state.tick / 500)),
        spawnedTick: state.tick,
        lastMoveTick: state.tick,
      }
    }
    x += hash2(x, tries, WORLD_SEED + 42) > 0.5 ? 1 : -1
    y += hash2(y, tries, WORLD_SEED + 43) > 0.5 ? 1 : -1
  }
  return null
}

function stepCamp(camp: Camp, state: GameState): Camp {
  const target = nearestItem(state.castle.filter((i) => i.status === 'built'), camp.x, camp.y)
  if (!target) return camp
  const dx = target.x - camp.x
  const dy = target.y - camp.y
  if (Math.abs(dx) + Math.abs(dy) <= 1) return camp // sieging, stay put
  const stepX: [number, number] = [camp.x + Math.sign(dx), camp.y]
  const stepY: [number, number] = [camp.x, camp.y + Math.sign(dy)]
  const prefer = Math.abs(dx) >= Math.abs(dy) ? [stepX, stepY] : [stepY, stepX]
  for (const [nx, ny] of prefer) {
    if (nx === camp.x && ny === camp.y) continue
    if (state.camps.some((c) => c.id !== camp.id && c.x === nx && c.y === ny)) continue
    if (enemyPassable(nx, ny, state.castle)) return { ...camp, x: nx, y: ny, lastMoveTick: state.tick }
  }
  return camp
}

// ---------- the world tick ----------

/** Advance the world by one tick. Pure; called by the reducer on every answered card. */
export function advanceWorld(state: GameState): GameState {
  const tick = state.tick + 1
  let { coins, bricks, wood, stone, food } = state.wallet

  for (const item of state.castle) {
    if (item.status !== 'built') continue
    const prod = PRODUCTION[item.type as keyof typeof PRODUCTION]
    if (!prod) continue
    const age = tick - (item.builtTick ?? 0)
    if (age > 0 && age % prod.every === 0) {
      if (prod.resource === 'wood') wood++
      else if (prod.resource === 'stone') stone++
      else food++
    }
  }

  let camps = state.camps
  if (tick % CAMP_MOVE_EVERY === 0 && camps.length) {
    const next: Camp[] = []
    for (const c of camps) next.push(stepCamp(c, { ...state, tick, camps: next.concat(camps.slice(next.length)) }))
    camps = next
  }
  if (tick % CAMP_SPAWN_EVERY === 0) {
    const spawned = spawnCamp({ ...state, tick, camps })
    if (spawned) camps = [...camps, spawned]
  }

  return { ...state, tick, camps, wallet: { coins, bricks, wood, stone, food } }
}
