import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerReward,
  computeTimeBonuses,
  GRADUATION_BONUS,
  SHOP,
  canAfford,
  canBuildAt,
  buildItem,
  rebuildCost,
  ruinTarget,
} from './economy.js'
import { terrainAt } from './world.js'
import type { CastleItem, Wallet } from './types.js'

test('answerReward per exercise type with first-try bonus', () => {
  assert.equal(answerReward('choice', false), 1)
  assert.equal(answerReward('choice', true), 2)
  assert.equal(answerReward('blank', true), 3)
  assert.equal(answerReward('match', false), 2) // per pair
  assert.equal(answerReward('lightning', false, 3), 3) // 1 x combo
  assert.equal(answerReward('sound', false), 2)
})

test('time bonuses: 20/40/60 tiers then +50 per extra 20 min', () => {
  assert.deepEqual(computeTimeBonuses(19, 0), { coins: 0, paidUpTo: 0 })
  assert.deepEqual(computeTimeBonuses(21, 0), { coins: 25, paidUpTo: 20 })
  assert.deepEqual(computeTimeBonuses(45, 20), { coins: 35, paidUpTo: 40 })
  assert.deepEqual(computeTimeBonuses(85, 40), { coins: 100, paidUpTo: 80 })
})

test('graduation bonus shape', () => {
  assert.deepEqual(GRADUATION_BONUS, { coins: 10, bricks: 1 })
})

const wallet = (w: Partial<Wallet>): Wallet => ({ coins: 0, bricks: 0, wood: 0, stone: 0, food: 0, ...w })
let n = 0
const I = (type: CastleItem['type'], x: number, y: number): CastleItem =>
  ({ id: `${type}${n++}`, type, x, y, status: 'built', builtAt: '2026-07-01T10:00:00Z', builtTick: 0 })

test('canAfford checks all five resources', () => {
  assert.equal(canAfford('wall', wallet({ coins: 99, stone: 2, bricks: 1 })), true)
  assert.equal(canAfford('wall', wallet({ coins: 99, stone: 1, bricks: 1 })), false)
  assert.equal(canAfford('bridge', wallet({ coins: 99, wood: 4 })), false)
})

test('canBuildAt: connectivity from the existing network', () => {
  const rich = wallet({ coins: 999, bricks: 99, wood: 99, stone: 99, food: 99 })
  // homeland (0..7) is grass; empty castle allows the first build anywhere
  assert.equal(canBuildAt('road', 3, 3, rich, []).ok, true)
  const net = [I('road', 3, 3)]
  assert.equal(canBuildAt('road', 4, 3, rich, net).ok, true)
  assert.equal(canBuildAt('road', 6, 6, rich, net).ok, false) // detached
  assert.equal(canBuildAt('road', 3, 3, rich, net).ok, false) // occupied
})

test('canBuildAt: terrain rules', () => {
  const rich = wallet({ coins: 999, bricks: 99, wood: 99, stone: 99, food: 99 })
  // find a river and a mountain outside the homeland
  let river: [number, number] | null = null
  let mountain: [number, number] | null = null
  for (let x = -60; x <= 60 && (!river || !mountain); x++) {
    for (let y = -60; y <= 60 && (!river || !mountain); y++) {
      const t = terrainAt(x, y)
      if (t === 'river' && !river) river = [x, y]
      if (t === 'mountain' && !mountain) mountain = [x, y]
    }
  }
  assert.ok(river && mountain)
  const [rx, ry] = river!
  const [mx, my] = mountain!
  const nearRiver = [I('road', rx - 1, ry)]
  assert.equal(canBuildAt('bridge', rx, ry, rich, nearRiver).ok, true)
  assert.equal(canBuildAt('wall', rx, ry, rich, nearRiver).ok, false) // only bridges on water
  assert.equal(canBuildAt('bridge', 3, 4, rich, [I('road', 3, 3)]).ok, false) // bridge needs water
  assert.equal(canBuildAt('road', mx, my, rich, [I('road', mx - 1, my)]).ok, false) // mountains unbuildable
})

test('canBuildAt: woodcutter needs forest neighbor, quarry needs mountains', () => {
  const rich = wallet({ coins: 999, bricks: 99, wood: 99, stone: 99, food: 99 })
  // homeland tile far from any forest/mountain
  assert.equal(canBuildAt('woodcutter', 3, 3, rich, []).ok, false)
  assert.equal(canBuildAt('quarry', 3, 3, rich, []).ok, false)
  // find grass adjacent to forest
  let spot: [number, number] | null = null
  outer: for (let x = -60; x <= 60; x++) for (let y = -60; y <= 60; y++) {
    if (terrainAt(x, y) === 'grass' && terrainAt(x + 1, y) === 'forest') { spot = [x, y]; break outer }
  }
  assert.ok(spot)
  const [fx, fy] = spot!
  assert.equal(canBuildAt('woodcutter', fx, fy, rich, [I('road', fx - 1, fy)]).ok, true)
})

test('buildItem charges the full resource mix', () => {
  const { wallet: w2, item } = buildItem('wall', wallet({ coins: 50, bricks: 5, stone: 4, wood: 2, food: 1 }), 0, 0, '2026-07-04T09:00:00Z', 42)
  assert.equal(w2.coins, 40)
  assert.equal(w2.stone, 2)
  assert.equal(w2.bricks, 4)
  assert.equal(item.builtTick, 42)
})

test('rebuild cost is half coins', () => {
  assert.deepEqual(rebuildCost('tower'), { coins: 40 })
})

test('ruinTarget picks latest built, skips land and roads', () => {
  const items: CastleItem[] = [
    { ...I('road', 0, 1), builtAt: '2026-07-05T10:00:00Z' },
    { ...I('wall', 0, 0), builtAt: '2026-07-02T10:00:00Z' },
    { ...I('field', 1, 0), builtAt: '2026-07-03T10:00:00Z' },
  ]
  assert.equal(ruinTarget(items)?.type, 'field')
  assert.equal(ruinTarget([I('road', 0, 0)]), null)
})
