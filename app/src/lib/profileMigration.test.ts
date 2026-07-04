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

test('pre-world saves get resources, tick, camps and collections defaulted', () => {
  const s = initialGameState()
  const raw = JSON.parse(serializeState(s))
  raw.wallet = { coins: 120, bricks: 4 } // old two-resource wallet
  delete raw.tick
  delete raw.camps
  delete raw.chestsCollected
  delete raw.letters
  delete raw.unlockedCategories
  const restored = deserializeState(JSON.stringify(raw))
  assert.deepEqual(restored.wallet, { coins: 120, bricks: 4, wood: 0, stone: 0, food: 0 })
  assert.equal(restored.tick, 0)
  assert.deepEqual(restored.camps, [])
  assert.deepEqual(restored.letters, [])
  assert.equal(restored.unlockedCategories, null)
})

test('saves with an empty castle get the starting plot back', () => {
  const raw = JSON.parse(serializeState(initialGameState()))
  raw.castle = []
  const restored = deserializeState(JSON.stringify(raw))
  assert.equal(restored.castle.length, 1)
  assert.equal(restored.castle[0].type, 'land')
})

test('sound reward is 2 coins per correct', () => {
  assert.equal(answerReward('sound', false), 2)
})
