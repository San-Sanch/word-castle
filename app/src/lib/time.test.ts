import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, diffDays, todayISO, missedFullDays, computeStreak } from './time.js'

test('todayISO formats local date', () => {
  assert.equal(todayISO(new Date(2026, 6, 4, 23, 30)), '2026-07-04')
  assert.equal(todayISO(new Date(2026, 0, 9, 0, 5)), '2026-01-09')
})

test('addDays and diffDays', () => {
  assert.equal(addDays('2026-07-04', 8), '2026-07-12')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(diffDays('2026-07-01', '2026-07-04'), 3)
})

test('missedFullDays: active yesterday means none missed', () => {
  assert.equal(missedFullDays('2026-07-03', '2026-07-04'), 0)
  assert.equal(missedFullDays('2026-07-01', '2026-07-04'), 2)
  assert.equal(missedFullDays('2026-07-04', '2026-07-04'), 0)
})

test('computeStreak: consecutive active days ending today or yesterday', () => {
  const logs = [
    { date: '2026-07-01', cardsAnswered: 30 },
    { date: '2026-07-02', cardsAnswered: 12 },
    { date: '2026-07-03', cardsAnswered: 40 },
  ]
  assert.equal(computeStreak(logs, '2026-07-04'), 3) // yesterday counts, streak alive
  assert.equal(computeStreak(logs, '2026-07-05'), 0) // gap of a full day, dead
  assert.equal(computeStreak([...logs, { date: '2026-07-04', cardsAnswered: 5 }], '2026-07-04'), 4)
  assert.equal(computeStreak([{ date: '2026-07-01', cardsAnswered: 3 }], '2026-07-04'), 0)
})
