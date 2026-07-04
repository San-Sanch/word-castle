import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialGameState, gameReducer, todayLog, introducedTodayCount } from './game.js'
import type { GameState } from './game.js'

const T = '2026-07-04'

function withReview(state: GameState, wordId: string, box: number, direction: 'recognition' | 'recall'): GameState {
  return {
    ...state,
    reviews: [
      ...state.reviews,
      { wordId, direction, box, dueAt: T, lapses: 0, streak: 0, introducedAt: '2026-06-01' },
    ],
  }
}

test('introduce: creates recognition state and counts toward today', () => {
  let s = initialGameState()
  s = gameReducer(s, { type: 'introduce', wordId: 'w1', today: T })
  assert.equal(s.reviews.length, 1)
  assert.equal(s.reviews[0].direction, 'recognition')
  assert.equal(introducedTodayCount(s, T), 1)
})

test('answer correct: coins, box up, recall activation at box 3', () => {
  let s = withReview(initialGameState(), 'w1', 2, 'recognition')
  s = gameReducer(s, { type: 'answer', wordId: 'w1', direction: 'recognition', correct: true, firstTry: true, rewardKind: 'choice', today: T })
  assert.equal(s.wallet.coins, 2) // 1 + first-try
  const rec = s.reviews.find((r) => r.direction === 'recognition')!
  assert.equal(rec.box, 3)
  assert.ok(s.reviews.some((r) => r.direction === 'recall'), 'recall state created')
  assert.equal(todayLog(s, T).correct, 1)
})

test('answer wrong: no coins, box drops, mistake logged', () => {
  let s = withReview(initialGameState(), 'w1', 4, 'recognition')
  s = gameReducer(s, { type: 'answer', wordId: 'w1', direction: 'recognition', correct: false, firstTry: true, rewardKind: 'choice', today: T })
  assert.equal(s.wallet.coins, 0)
  assert.equal(s.reviews[0].box, 2)
  assert.equal(todayLog(s, T).mistakes, 1)
})

test('graduation pays once', () => {
  let s = withReview(initialGameState(), 'w1', 3, 'recall')
  s = gameReducer(s, { type: 'answer', wordId: 'w1', direction: 'recall', correct: true, firstTry: false, rewardKind: 'choice', today: T })
  assert.equal(s.wallet.bricks, 1)
  assert.equal(s.wallet.coins, 1 + 10)
  // drop below and re-graduate: no second payment
  s = gameReducer(s, { type: 'answer', wordId: 'w1', direction: 'recall', correct: false, firstTry: true, rewardKind: 'choice', today: T })
  s = { ...s, reviews: s.reviews.map((r) => (r.direction === 'recall' ? { ...r, box: 3 } : r)) }
  s = gameReducer(s, { type: 'answer', wordId: 'w1', direction: 'recall', correct: true, firstTry: false, rewardKind: 'choice', today: T })
  assert.equal(s.wallet.bricks, 1)
})

test('activeTime accumulates and pays tier bonus once', () => {
  let s = initialGameState()
  for (let i = 0; i < 4; i++) s = gameReducer(s, { type: 'activeTime', seconds: 300, today: T })
  assert.equal(todayLog(s, T).activeSeconds, 1200)
  assert.equal(s.wallet.coins, 25) // 20-min tier
  s = gameReducer(s, { type: 'activeTime', seconds: 60, today: T })
  assert.equal(s.wallet.coins, 25) // not paid twice
})

test('build and rebuild', () => {
  let s = { ...initialGameState(), wallet: { coins: 200, bricks: 10 } }
  s = gameReducer(s, { type: 'build', itemType: 'land', x: 0, y: 0, nowIso: '2026-07-04T10:00:00Z' })
  s = gameReducer(s, { type: 'build', itemType: 'wall', x: 0, y: 0, nowIso: '2026-07-04T10:01:00Z' })
  assert.equal(s.castle.length, 2)
  assert.equal(s.wallet.coins, 200 - 50 - 30)
  assert.equal(s.wallet.bricks, 5)
  const wall = s.castle.find((i) => i.type === 'wall')!
  s = { ...s, castle: s.castle.map((i) => (i.id === wall.id ? { ...i, status: 'ruin' as const } : i)) }
  s = gameReducer(s, { type: 'rebuild', itemId: wall.id })
  assert.equal(s.castle.find((i) => i.id === wall.id)!.status, 'built')
  assert.equal(s.wallet.coins, 120 - 15)
})

test('raidCheck: applies once per day, ruins on 2+ missed days', () => {
  let s = { ...initialGameState(), wallet: { coins: 100, bricks: 0 } }
  s = { ...s, dayLogs: [{ ...todayLog(s, '2026-07-01'), date: '2026-07-01', cardsAnswered: 10 }] }
  s = gameReducer(s, { type: 'build', itemType: 'land', x: 0, y: 0, nowIso: '2026-07-01T10:00:00Z' })
  s = { ...s, wallet: { coins: 100, bricks: 5 } }
  s = gameReducer(s, { type: 'build', itemType: 'wall', x: 0, y: 0, nowIso: '2026-07-01T10:01:00Z' })
  const coinsBefore = s.wallet.coins
  s = gameReducer(s, { type: 'raidCheck', today: T }) // missed 07-02 and 07-03
  assert.equal(s.attacks.length, 1)
  assert.equal(s.attacks[0].kind, 'raid')
  assert.ok(s.wallet.coins < coinsBefore)
  assert.equal(s.castle.find((i) => i.type === 'wall')!.status, 'ruin')
  const again = gameReducer(s, { type: 'raidCheck', today: T })
  assert.equal(again.attacks.length, 1) // idempotent per day
})

test('raidCheck: fresh state (never played) does not raid', () => {
  const s = gameReducer(initialGameState(), { type: 'raidCheck', today: T })
  assert.equal(s.attacks.length, 0)
})

test('sessionAttack outcome applied: ruin tears down latest upgrade', () => {
  let s = { ...initialGameState(), wallet: { coins: 300, bricks: 20 } }
  s = gameReducer(s, { type: 'build', itemType: 'land', x: 0, y: 0, nowIso: '2026-07-04T09:00:00Z' })
  s = gameReducer(s, { type: 'build', itemType: 'wall', x: 0, y: 0, nowIso: '2026-07-04T09:01:00Z' })
  s = gameReducer(s, {
    type: 'applyAttack', kind: 'session', severity: 8, defense: 1,
    result: 'ruin', coinsDelta: 0, ruin: true, today: T,
  })
  assert.equal(s.castle.find((i) => i.type === 'wall')!.status, 'ruin')
  assert.equal(s.attacks.length, 1)
})

test('coins never go negative', () => {
  let s = { ...initialGameState(), wallet: { coins: 10, bricks: 0 } }
  s = gameReducer(s, {
    type: 'applyAttack', kind: 'session', severity: 5, defense: 0,
    result: 'coin-loss', coinsDelta: -50, ruin: false, today: T,
  })
  assert.equal(s.wallet.coins, 0)
})
