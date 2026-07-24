import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INTERVALS_DAYS,
  newReviewState,
  applyAnswer,
  shouldActivateRecall,
  isGraduated,
  buildSessionPlan,
} from './srs.js'
import type { ReviewState, Word } from './types.js'

const W = (id: string, category = 'Family'): Word => ({
  id, hebrew: id, hebrewFull: id, gender: null, plural: null,
  translation: 't-' + id, translationLang: 'ua', category,
})

test('intervals ladder', () => {
  assert.deepEqual(INTERVALS_DAYS, [0, 1, 2, 4, 8, 16, 32, 64])
})

test('applyAnswer: correct climbs one box and schedules ahead', () => {
  const s = newReviewState('w1', 'recognition', '2026-07-04')
  const s1 = applyAnswer(s, true, '2026-07-04')
  assert.equal(s1.box, 1)
  assert.equal(s1.dueAt, '2026-07-05')
  const s2 = applyAnswer({ ...s1, box: 7 }, true, '2026-07-04')
  assert.equal(s2.box, 7) // capped
  assert.equal(s2.dueAt, '2026-09-06') // +64
})

test('applyAnswer: mistake drops two boxes, re-queues today', () => {
  const s: ReviewState = { ...newReviewState('w1', 'recognition', '2026-07-01'), box: 5, streak: 4 }
  const s1 = applyAnswer(s, false, '2026-07-04')
  assert.equal(s1.box, 3)
  assert.equal(s1.dueAt, '2026-07-04')
  assert.equal(s1.lapses, 1)
  assert.equal(s1.streak, 0)
})

test('recall activates when recognition reaches box 2', () => {
  const rec = { ...newReviewState('w1', 'recognition', '2026-07-01'), box: 2 }
  assert.equal(shouldActivateRecall(rec, false), true)
  assert.equal(shouldActivateRecall(rec, true), false) // already exists
  assert.equal(shouldActivateRecall({ ...rec, box: 1 }, false), false)
})

test('graduation: recall box >= 3', () => {
  const rc = { ...newReviewState('w1', 'recall', '2026-07-01'), box: 3 }
  assert.equal(isGraduated(rc), true)
  assert.equal(isGraduated({ ...rc, box: 2 }), false)
  assert.equal(isGraduated({ ...rc, direction: 'recognition' as const, box: 7 }), false)
})

test('buildSessionPlan: due recall cards outrank a recognition backlog', () => {
  // a big overdue recognition backlog must not crowd recall cards out of the session
  const words = [W('a'), W('b'), W('c'), W('d')]
  const states: ReviewState[] = [
    { ...newReviewState('a', 'recognition', '2026-06-01'), dueAt: '2026-07-01' },
    { ...newReviewState('b', 'recognition', '2026-06-01'), dueAt: '2026-07-01' },
    { ...newReviewState('c', 'recognition', '2026-06-01'), dueAt: '2026-07-01' },
    { ...newReviewState('d', 'recall', '2026-06-20'), dueAt: '2026-07-03', box: 2 },
  ]
  const plan = buildSessionPlan({
    words, states, today: '2026-07-04',
    settings: { sessionSize: 2, newWordsPerDay: 0 },
    introducedToday: 0,
  })
  assert.equal(plan.dueStates[0].direction, 'recall')
  assert.equal(plan.dueStates.length, 2)
})

test('buildSessionPlan: due first (oldest), then new words up to daily limit', () => {
  const words = [W('a'), W('b'), W('c'), W('d'), W('e')]
  const states: ReviewState[] = [
    { ...newReviewState('a', 'recognition', '2026-06-01'), dueAt: '2026-07-01' },
    { ...newReviewState('b', 'recognition', '2026-06-01'), dueAt: '2026-07-03' },
    { ...newReviewState('c', 'recognition', '2026-06-01'), dueAt: '2026-07-09' }, // not due
  ]
  const plan = buildSessionPlan({
    words, states, today: '2026-07-04',
    settings: { sessionSize: 25, newWordsPerDay: 2 },
    introducedToday: 0,
  })
  assert.deepEqual(plan.dueStates.map((s) => s.wordId), ['a', 'b'])
  assert.deepEqual(plan.newWordIds, ['d', 'e'])
})

test('a word answered correctly today is NOT served again the same day', () => {
  const today = '2026-07-04'
  const answered = applyAnswer(newReviewState('a', 'recognition', today), true, today)
  assert.ok(answered.dueAt > today, 'correct answer must schedule beyond today')
  const plan = buildSessionPlan({
    words: [W('a'), W('b')], states: [answered], today,
    settings: { sessionSize: 25, newWordsPerDay: 0 },
    introducedToday: 99,
  })
  assert.equal(plan.dueStates.some((s) => s.wordId === 'a'), false)
})

test('buildSessionPlan: topic filter narrows due reviews and new words', () => {
  const words = [W('a', 'Verbs'), W('b', 'Family'), W('c', 'Verbs'), W('d', 'Family')]
  const states: ReviewState[] = [
    { ...newReviewState('a', 'recognition', '2026-06-01'), dueAt: '2026-07-01' },
    { ...newReviewState('b', 'recognition', '2026-06-01'), dueAt: '2026-07-01' },
  ]
  const plan = buildSessionPlan({
    words, states, today: '2026-07-04',
    settings: { sessionSize: 25, newWordsPerDay: 5 },
    introducedToday: 0,
    topic: 'Verbs',
  })
  assert.deepEqual(plan.dueStates.map((s) => s.wordId), ['a'])
  assert.deepEqual(plan.newWordIds, ['c'])
})

test('buildSessionPlan: ignoreNewLimit keeps serving new words past the daily cap', () => {
  const words = [W('a'), W('b'), W('c'), W('d')]
  const plan = buildSessionPlan({
    words, states: [], today: '2026-07-04',
    settings: { sessionSize: 3, newWordsPerDay: 1 },
    introducedToday: 5,
    ignoreNewLimit: true,
  })
  assert.deepEqual(plan.newWordIds, ['a', 'b', 'c']) // sessionSize still caps it
})

test('buildSessionPlan: respects sessionSize and introducedToday', () => {
  const words = [W('a'), W('b'), W('c')]
  const states: ReviewState[] = [
    { ...newReviewState('a', 'recognition', '2026-06-01'), dueAt: '2026-07-01' },
    { ...newReviewState('b', 'recognition', '2026-06-01'), dueAt: '2026-07-02' },
  ]
  const plan = buildSessionPlan({
    words, states, today: '2026-07-04',
    settings: { sessionSize: 2, newWordsPerDay: 5 },
    introducedToday: 5,
  })
  assert.equal(plan.dueStates.length, 2)
  assert.deepEqual(plan.newWordIds, []) // no room and daily new limit reached
})
