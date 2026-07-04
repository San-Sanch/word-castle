import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialGameState, newPlayerState, gameReducer, todayLog, introducedTodayCount } from './game.js'
import type { GameState } from './game.js'
import { hasChestAt } from './world.js'
import type { CastleItem } from './types.js'

const T = '2026-07-04'

const rich = (s: GameState): GameState => ({
  ...s,
  wallet: { coins: 999, bricks: 99, wood: 99, stone: 99, food: 99 },
})

let n = 0
const I = (type: CastleItem['type'], x: number, y: number, status: 'built' | 'ruin' = 'built'): CastleItem =>
  ({ id: `${type}${n++}`, type, x, y, status, builtAt: `2026-07-0${1 + (n % 5)}T10:00:00Z`, builtTick: 0 })

function withReview(state: GameState, wordId: string, box: number, direction: 'recognition' | 'recall'): GameState {
  return {
    ...state,
    reviews: [
      ...state.reviews,
      { wordId, direction, box, dueAt: T, lapses: 0, streak: 0, introducedAt: '2026-06-01' },
    ],
  }
}

test('newPlayerState starts with the castle site plot', () => {
  const s = newPlayerState()
  assert.equal(s.castle.length, 1)
  assert.equal(s.castle[0].type, 'land')
})

test('introduce: creates recognition state and counts toward today', () => {
  let s = initialGameState()
  s = gameReducer(s, { type: 'introduce', wordId: 'w1', today: T })
  assert.equal(s.reviews.length, 1)
  assert.equal(introducedTodayCount(s, T), 1)
})

test('answer: coins, box up, recall activation, and the world ticks', () => {
  let s = withReview(initialGameState(), 'w1', 2, 'recognition')
  s = gameReducer(s, { type: 'answer', wordId: 'w1', direction: 'recognition', correct: true, firstTry: true, rewardKind: 'choice', today: T })
  assert.equal(s.wallet.coins, 2)
  assert.equal(s.reviews.find((r) => r.direction === 'recognition')!.box, 3)
  assert.ok(s.reviews.some((r) => r.direction === 'recall'))
  assert.equal(s.tick, 1) // learning advances the world
  assert.equal(todayLog(s, T).correct, 1)
})

test('graduation pays once', () => {
  let s = withReview(initialGameState(), 'w1', 3, 'recall')
  s = gameReducer(s, { type: 'answer', wordId: 'w1', direction: 'recall', correct: true, firstTry: false, rewardKind: 'choice', today: T })
  assert.equal(s.wallet.bricks, 1)
  assert.equal(s.wallet.coins, 11)
  s = gameReducer(s, { type: 'answer', wordId: 'w1', direction: 'recall', correct: false, firstTry: true, rewardKind: 'choice', today: T })
  s = { ...s, reviews: s.reviews.map((r) => (r.direction === 'recall' ? { ...r, box: 3 } : r)) }
  s = gameReducer(s, { type: 'answer', wordId: 'w1', direction: 'recall', correct: true, firstTry: false, rewardKind: 'choice', today: T })
  assert.equal(s.wallet.bricks, 1)
})

test('activeTime accumulates and pays tier bonus once', () => {
  let s = initialGameState()
  for (let i = 0; i < 4; i++) s = gameReducer(s, { type: 'activeTime', seconds: 300, today: T })
  assert.equal(todayLog(s, T).activeSeconds, 1200)
  assert.equal(s.wallet.coins, 25)
  s = gameReducer(s, { type: 'activeTime', seconds: 60, today: T })
  assert.equal(s.wallet.coins, 25)
})

test('build: connectivity + resource mix; demolish refunds nothing', () => {
  let s = rich(newPlayerState()) // plot at 3,3
  s = gameReducer(s, { type: 'build', itemType: 'road', x: 4, y: 3, nowIso: '2026-07-04T10:00:00Z' })
  assert.equal(s.castle.length, 2)
  assert.equal(s.wallet.coins, 999 - 5)
  s = gameReducer(s, { type: 'build', itemType: 'wall', x: 5, y: 3, nowIso: '2026-07-04T10:01:00Z' })
  assert.equal(s.wallet.stone, 97)
  assert.equal(s.wallet.bricks, 98)
  // detached build rejected
  const before = s.castle.length
  s = gameReducer(s, { type: 'build', itemType: 'road', x: 30, y: 30, nowIso: '2026-07-04T10:02:00Z' })
  assert.equal(s.castle.length, before)
  // demolish: gone, nothing back
  const wall = s.castle.find((i) => i.type === 'wall')!
  const coinsBefore = s.wallet.coins
  s = gameReducer(s, { type: 'demolish', itemId: wall.id })
  assert.equal(s.castle.some((i) => i.id === wall.id), false)
  assert.equal(s.wallet.coins, coinsBefore)
  assert.equal(s.wallet.stone, 97)
})

test('collectChest: needs vision, pays once', () => {
  // find a chest and grant vision by injecting a nearby item
  let chest: [number, number] | null = null
  outer: for (let x = -80; x <= 80; x++) for (let y = -80; y <= 80; y++) {
    if (hasChestAt(x, y)) { chest = [x, y]; break outer }
  }
  assert.ok(chest)
  const [cx, cy] = chest!
  let s: GameState = { ...initialGameState(), castle: [I('land', cx + 1, cy)] }
  s = gameReducer(s, { type: 'collectChest', x: cx, y: cy })
  assert.equal(s.chestsCollected.length, 1)
  const gained = s.wallet.coins > 0 || s.letters.length === 1
  assert.ok(gained)
  const again = gameReducer(s, { type: 'collectChest', x: cx, y: cy })
  assert.deepEqual(again.chestsCollected, s.chestsCollected)
  assert.equal(again.wallet.coins, s.wallet.coins)
  // invisible chest cannot be collected
  const blind: GameState = { ...initialGameState(), castle: [] }
  assert.equal(gameReducer(blind, { type: 'collectChest', x: cx, y: cy }).chestsCollected.length, 0)
})

test('applyAttack: walls protect, breach ignores protection, camp cleared on win', () => {
  // closed 3x3 ring with gate around keep at (1,1), field outside
  const ring: CastleItem[] = []
  for (let x = 0; x <= 2; x++) for (let y = 0; y <= 2; y++) {
    if (x === 1 && y === 1) continue
    ring.push(I(x === 1 && y === 0 ? 'gate' : 'wall', x, y))
  }
  const keep = { ...I('keep', 1, 1), builtAt: '2026-07-09T10:00:00Z' }
  const field = { ...I('field', 5, 5), builtAt: '2026-07-08T10:00:00Z' }
  const base: GameState = {
    ...initialGameState(),
    castle: [...ring, keep, field],
    camps: [{ id: 'c1', x: 6, y: 5, strength: 5, spawnedTick: 0, lastMoveTick: 0 }],
  }
  // normal ruin: keep is protected, field burns even though keep is newer
  let s = gameReducer(base, { type: 'applyAttack', kind: 'session', severity: 5, defense: 2, result: 'ruin', coinsDelta: 0, ruin: true, breach: false, campId: 'c1', today: T })
  assert.equal(s.castle.find((i) => i.id === field.id)!.status, 'ruin')
  assert.equal(s.castle.find((i) => i.id === keep.id)!.status, 'built')
  assert.equal(s.camps.length, 1) // defeat does not clear the camp
  // breach: protection ignored, newest building falls (the keep)
  s = gameReducer(base, { type: 'applyAttack', kind: 'session', severity: 5, defense: 2, result: 'ruin', coinsDelta: 0, ruin: true, breach: true, campId: 'c1', today: T })
  assert.equal(s.castle.find((i) => i.id === keep.id)!.status, 'ruin')
  // win removes the camp
  s = gameReducer(base, { type: 'applyAttack', kind: 'session', severity: 5, defense: 2, result: 'win', coinsDelta: 30, ruin: false, campId: 'c1', today: T })
  assert.equal(s.camps.length, 0)
})

test('raidCheck: once per day, guardian upkeep eats food, hunger drops a level', () => {
  let s: GameState = {
    ...initialGameState(),
    wallet: { coins: 100, bricks: 0, wood: 0, stone: 0, food: 5 },
    guardian: { name: 'G', avatar: 'x', category: 'Verbs', level: 4, setsCompleted: 6, hiredAt: '2026-06-01' },
    lastRaidCheck: '2026-07-03',
    dayLogs: [{ date: '2026-07-03', cardsAnswered: 10, correct: 9, mistakes: 1, activeSeconds: 600, coinsEarned: 10, timeBonusPaidUpTo: 0, graduated: 0 }],
  }
  s = gameReducer(s, { type: 'raidCheck', today: T })
  assert.equal(s.wallet.food, 3) // ate 2
  assert.equal(s.guardian!.level, 4)
  const idem = gameReducer(s, { type: 'raidCheck', today: T })
  assert.equal(idem.wallet.food, 3) // idempotent per day
  // starving guardian loses a level
  let hungry: GameState = { ...s, lastRaidCheck: '2026-07-03', wallet: { ...s.wallet, food: 0 } }
  hungry = gameReducer(hungry, { type: 'raidCheck', today: T })
  assert.equal(hungry.guardian!.level, 3)
})

test('raidCheck: fresh state never raids', () => {
  const s = gameReducer(initialGameState(), { type: 'raidCheck', today: T })
  assert.equal(s.attacks.length, 0)
})

test('coins never go negative', () => {
  let s = { ...initialGameState(), wallet: { coins: 10, bricks: 0, wood: 0, stone: 0, food: 0 } }
  s = gameReducer(s, { type: 'applyAttack', kind: 'session', severity: 5, defense: 0, result: 'coin-loss', coinsDelta: -50, ruin: false, today: T })
  assert.equal(s.wallet.coins, 0)
})
