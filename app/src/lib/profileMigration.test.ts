import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deserializeState, serializeState } from './storage.js'
import { initialGameState } from './game.js'
import { answerReward } from './economy.js'

test('old saves without exercises.sound get the default value', () => {
  const s = initialGameState()
  const raw = JSON.parse(serializeState(s))
  delete raw.settings.exercises.sound
  const restored = deserializeState(JSON.stringify(raw))
  assert.equal(restored.settings.exercises.sound, true)
})

test('sound reward is 2 coins per correct', () => {
  assert.equal(answerReward('sound', false), 2)
})
