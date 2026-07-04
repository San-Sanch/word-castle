import { test } from 'node:test'
import assert from 'node:assert/strict'
import { castleDefense, lightningTarget, resolveSessionAttack, resolveRaid } from './attack.js'
import type { CastleItem } from './types.js'

const item = (type: CastleItem['type'], status: CastleItem['status'] = 'built'): CastleItem =>
  ({ id: type, type, x: 0, y: 0, status, builtAt: '2026-07-01T00:00:00Z' })

test('castleDefense sums built items only', () => {
  const c = [item('land'), item('wall'), item('wall'), item('gate'), item('tower'), item('tower', 'ruin')]
  // wall 1 + wall 1 + gate 2 + tower 3 = 7 (ruined tower ignored, land 0)
  assert.equal(castleDefense(c), 7)
})

test('lightningTarget: severity*3 - defense, floor 5', () => {
  assert.equal(lightningTarget(10, 5), 25)
  assert.equal(lightningTarget(2, 20), 5)
})

test('resolveSessionAttack outcomes', () => {
  const rng = () => 0.5
  const win = resolveSessionAttack({ target: 10, correct: 10, coins: 400, rng })
  assert.equal(win.result, 'win')
  assert.ok(win.coinsDelta >= 20 && win.coinsDelta <= 50)
  const narrow = resolveSessionAttack({ target: 10, correct: 5, coins: 400, rng })
  assert.equal(narrow.result, 'coin-loss')
  assert.equal(narrow.coinsDelta, -40) // 10% of 400
  const capped = resolveSessionAttack({ target: 10, correct: 5, coins: 9999, rng })
  assert.equal(capped.coinsDelta, -50) // capped
  const heavy = resolveSessionAttack({ target: 10, correct: 4, coins: 400, rng })
  assert.equal(heavy.result, 'ruin')
})

test('resolveRaid: coin loss shrinks with guardian level, ruin from 2+ missed days', () => {
  const r1 = resolveRaid({ daysMissed: 1, guardianLevel: 0, coins: 300 })
  assert.deepEqual(r1, { coinsDelta: -30, ruin: false, result: 'coin-loss' })
  const r2 = resolveRaid({ daysMissed: 1, guardianLevel: 10, coins: 300 })
  assert.deepEqual(r2, { coinsDelta: 0, ruin: false, result: 'defended' })
  const r3 = resolveRaid({ daysMissed: 2, guardianLevel: 3, coins: 300 })
  assert.equal(r3.coinsDelta, -21) // (10-3)% of 300
  assert.equal(r3.ruin, true)
  const r4 = resolveRaid({ daysMissed: 3, guardianLevel: 8, coins: 300 })
  assert.equal(r4.ruin, false) // level 8+ guards the walls overnight
})
