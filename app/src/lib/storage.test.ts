import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serializeState, deserializeState } from './storage.js'
import { initialGameState, newPlayerState } from './game.js'

test('serialize/deserialize round-trip', () => {
  const s = newPlayerState()
  s.wallet.coins = 42
  const restored = deserializeState(serializeState(s))
  assert.deepEqual(restored, s)
})

test('deserialize rejects garbage and wrong versions', () => {
  assert.throws(() => deserializeState('not json'))
  assert.throws(() => deserializeState('{"version":99}'))
  assert.throws(() => deserializeState('{"version":1}')) // missing fields
})

test('deserialize backfills graduatedIds from already-graduated recall states', () => {
  // saves made under the old, stricter thresholds must gain their earned graduations on load
  const s = newPlayerState()
  s.reviews = [
    { wordId: 'w1', direction: 'recall', box: 3, dueAt: '2026-07-26', lapses: 0, streak: 3, introducedAt: '2026-07-17' },
    { wordId: 'w2', direction: 'recall', box: 2, dueAt: '2026-07-26', lapses: 0, streak: 2, introducedAt: '2026-07-17' },
    { wordId: 'w3', direction: 'recognition', box: 7, dueAt: '2026-07-26', lapses: 0, streak: 7, introducedAt: '2026-07-17' },
  ]
  s.graduatedIds = ['w0']
  const restored = deserializeState(serializeState(s))
  assert.deepEqual(restored.graduatedIds, ['w0', 'w1'])
})

test('deserialize fills missing optional fields with defaults', () => {
  const s = initialGameState()
  const raw = JSON.parse(serializeState(s))
  delete raw.lastRaidCheck
  const restored = deserializeState(JSON.stringify(raw))
  assert.equal(restored.lastRaidCheck, null)
})
