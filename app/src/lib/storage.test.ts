import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serializeState, deserializeState } from './storage.js'
import { initialGameState } from './game.js'

test('serialize/deserialize round-trip', () => {
  const s = initialGameState()
  s.wallet.coins = 42
  const restored = deserializeState(serializeState(s))
  assert.deepEqual(restored, s)
})

test('deserialize rejects garbage and wrong versions', () => {
  assert.throws(() => deserializeState('not json'))
  assert.throws(() => deserializeState('{"version":99}'))
  assert.throws(() => deserializeState('{"version":1}')) // missing fields
})

test('deserialize fills missing optional fields with defaults', () => {
  const s = initialGameState()
  const raw = JSON.parse(serializeState(s))
  delete raw.lastRaidCheck
  const restored = deserializeState(JSON.stringify(raw))
  assert.equal(restored.lastRaidCheck, null)
})
