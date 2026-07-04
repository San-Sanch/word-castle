import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerReward,
  computeTimeBonuses,
  GRADUATION_BONUS,
  SHOP,
  canBuild,
  buildItem,
  rebuildCost,
  ruinTarget,
} from './economy.js'
import type { CastleItem, Wallet } from './types.js'

test('answerReward per exercise type with first-try bonus', () => {
  assert.equal(answerReward('choice', false), 1)
  assert.equal(answerReward('choice', true), 2)
  assert.equal(answerReward('blank', true), 3)
  assert.equal(answerReward('match', false), 2) // per pair
  assert.equal(answerReward('lightning', false, 3), 3) // 1 x combo
})

test('time bonuses: 20/40/60 tiers then +50 per extra 20 min', () => {
  let r = computeTimeBonuses(19, 0)
  assert.deepEqual(r, { coins: 0, paidUpTo: 0 })
  r = computeTimeBonuses(21, 0)
  assert.deepEqual(r, { coins: 25, paidUpTo: 20 })
  r = computeTimeBonuses(45, 20)
  assert.deepEqual(r, { coins: 35, paidUpTo: 40 })
  r = computeTimeBonuses(85, 40)
  assert.deepEqual(r, { coins: 100, paidUpTo: 80 }) // 60 tier (50) + 80 tier (50)
  r = computeTimeBonuses(85, 80)
  assert.deepEqual(r, { coins: 0, paidUpTo: 80 }) // already paid
})

test('graduation bonus shape', () => {
  assert.deepEqual(GRADUATION_BONUS, { coins: 10, bricks: 1 })
})

const wallet = (coins: number, bricks = 0): Wallet => ({ coins, bricks })
const land = (x: number, y: number): CastleItem =>
  ({ id: `l${x}${y}`, type: 'land', x, y, status: 'built', builtAt: '2026-07-01T10:00:00Z' })

test('canBuild: land on empty cell, buildings need land, towers need a gate', () => {
  assert.equal(canBuild('land', wallet(50), [], 0, 0).ok, true)
  assert.equal(canBuild('land', wallet(49), [], 0, 0).ok, false) // funds
  assert.equal(canBuild('wall', wallet(999, 99), [], 0, 0).ok, false) // no land
  assert.equal(canBuild('wall', wallet(999, 99), [land(0, 0)], 0, 0).ok, true)
  assert.equal(canBuild('tower', wallet(999, 99), [land(0, 0)], 0, 0).ok, false) // no gate
  const withGate = [land(0, 0), land(1, 0),
    { ...land(1, 0), id: 'g', type: 'gate' as const }]
  assert.equal(canBuild('tower', wallet(999, 99), withGate, 0, 0).ok, true)
  assert.equal(canBuild('gate', wallet(999, 99), withGate, 1, 0).ok, false) // cell occupied
})

test('buildItem charges wallet and stamps position', () => {
  const { wallet: w2, item } = buildItem('wall', wallet(100, 10), [land(0, 0)], 0, 0, '2026-07-04T09:00:00Z')
  assert.equal(w2.coins, 100 - SHOP.wall.coins)
  assert.equal(w2.bricks, 10 - SHOP.wall.bricks)
  assert.equal(item.type, 'wall')
  assert.equal(item.status, 'built')
})

test('rebuild cost is half coins, zero bricks', () => {
  assert.deepEqual(rebuildCost('tower'), { coins: 100, bricks: 0 })
})

test('ruinTarget picks latest built non-land item', () => {
  const items: CastleItem[] = [
    land(0, 0),
    { id: 'w1', type: 'wall', x: 0, y: 0, status: 'built', builtAt: '2026-07-02T10:00:00Z' },
    { id: 't1', type: 'tower', x: 1, y: 0, status: 'built', builtAt: '2026-07-03T10:00:00Z' },
    { id: 'w2', type: 'wall', x: 2, y: 0, status: 'ruin', builtAt: '2026-07-04T10:00:00Z' },
  ]
  assert.equal(ruinTarget(items)?.id, 't1') // ruins and land skipped
  assert.equal(ruinTarget([land(0, 0)]), null)
})
