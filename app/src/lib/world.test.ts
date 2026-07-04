import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  terrainAt,
  hasChestAt,
  chestReward,
  visionSet,
  isVisible,
  enemyPassable,
  advanceWorld,
  PRODUCTION,
  CAMP_SPAWN_EVERY,
  CAMP_MOVE_EVERY,
  siegingCamp,
} from './world.js'
import type { CastleItem, Camp } from './types.js'
import { initialGameState } from './game.js'
import type { GameState } from './game.js'

const I = (type: CastleItem['type'], x: number, y: number, builtTick = 0): CastleItem =>
  ({ id: `${type}${x},${y}`, type, x, y, status: 'built', builtAt: '2026-07-01T00:00:00Z', builtTick })

test('terrain is deterministic and the homeland is grass', () => {
  for (let x = -1; x <= 8; x++)
    for (let y = -1; y <= 8; y++) assert.equal(terrainAt(x, y), 'grass')
  const a = terrainAt(37, -12)
  assert.equal(a, terrainAt(37, -12)) // stable
  // the world is not all grass: scan a band and expect variety
  const kinds = new Set<string>()
  for (let x = -60; x <= 60; x += 2) for (let y = -60; y <= 60; y += 2) kinds.add(terrainAt(x, y))
  assert.ok(kinds.has('forest') && kinds.has('mountain') && kinds.has('river'), [...kinds].join(','))
})

test('chests exist outside the homeland and rewards are deterministic', () => {
  let found = 0
  for (let x = -80; x <= 80; x++) for (let y = -80; y <= 80; y++) if (hasChestAt(x, y)) found++
  assert.ok(found > 5, `expected chests, found ${found}`)
  for (let x = -1; x <= 8; x++) for (let y = -1; y <= 8; y++) assert.equal(hasChestAt(x, y), false)
  const r = chestReward(23, 41)
  assert.deepEqual(r, chestReward(23, 41))
  assert.ok(r.coins > 0 || r.letter)
})

test('vision: radius around items, towers see farther', () => {
  const items = [I('land', 0, 0), I('tower', 20, 20)]
  const v = visionSet(items)
  assert.ok(isVisible(0, 3, v))
  assert.equal(isVisible(0, 4, v), false)
  assert.ok(isVisible(20, 25, v)) // tower radius 5
  assert.equal(isVisible(20, 26, v), false)
})

test('enemyPassable: mountains and rivers block, bridges open rivers', () => {
  // find a river tile outside homeland
  let river: [number, number] | null = null
  outer: for (let x = -60; x <= 60; x++) for (let y = -60; y <= 60; y++) {
    if (terrainAt(x, y) === 'river') { river = [x, y]; break outer }
  }
  assert.ok(river)
  const [rx, ry] = river!
  assert.equal(enemyPassable(rx, ry, []), false)
  assert.equal(enemyPassable(rx, ry, [I('bridge', rx, ry)]), true)
})

test('advanceWorld: producers add resources on their cadence', () => {
  let s: GameState = {
    ...initialGameState(),
    castle: [I('woodcutter', 0, 0, 0), I('field', 1, 0, 0), I('quarry', 2, 0, 0)],
  }
  for (let t = 0; t < PRODUCTION.woodcutter.every; t++) s = advanceWorld(s)
  assert.equal(s.wallet.wood, 1)
  assert.equal(s.tick, PRODUCTION.woodcutter.every)
  for (let t = s.tick; t < PRODUCTION.field.every; t++) s = advanceWorld(s)
  assert.equal(s.wallet.food, 1)
})

test('advanceWorld: camps spawn on schedule and march toward the castle', () => {
  let s: GameState = { ...initialGameState(), castle: [I('keep', 0, 0)] }
  for (let t = 0; t < CAMP_SPAWN_EVERY; t++) s = advanceWorld(s)
  assert.equal(s.camps.length, 1)
  const c0 = s.camps[0]
  const d0 = Math.abs(c0.x) + Math.abs(c0.y)
  for (let t = 0; t < CAMP_MOVE_EVERY * 3; t++) s = advanceWorld(s)
  const c1 = s.camps[0]
  const d1 = Math.abs(c1.x) + Math.abs(c1.y)
  assert.ok(d1 < d0, `camp should approach: ${d0} -> ${d1}`)
})

test('camps stop adjacent to the castle and siege', () => {
  const camp: Camp = { id: 'c1', x: 1, y: 0, strength: 4, spawnedTick: 0, lastMoveTick: 0 }
  let s: GameState = { ...initialGameState(), castle: [I('keep', 0, 0)], camps: [camp], tick: 10 }
  for (let t = 0; t < CAMP_MOVE_EVERY * 2; t++) s = advanceWorld(s)
  assert.deepEqual({ x: s.camps[0].x, y: s.camps[0].y }, { x: 1, y: 0 }) // did not walk onto the keep
  assert.equal(siegingCamp(s.camps, s.castle)?.id, 'c1')
})
