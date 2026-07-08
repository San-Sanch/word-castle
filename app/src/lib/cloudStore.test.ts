import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newPlayerState } from './game.js'
import { serializeState } from './storage.js'
import {
  loadCourseState,
  saveCourseState,
  migrateLocalToCloud,
  type ProgressBackend,
  type ProgressItem,
} from './cloudStore.js'

/** In-memory fake of the author-scoped `progress` collection: one item per course. */
function fakeBackend(seed: ProgressItem[] = []) {
  const rows = [...seed]
  let idSeq = 1
  const calls: { fetch: string[]; upsert: ProgressItem[] } = { fetch: [], upsert: [] }
  const backend: ProgressBackend = {
    async fetch(course) {
      calls.fetch.push(course)
      return rows.find((r) => r.course === course) ?? null
    },
    async upsert(item) {
      calls.upsert.push(item)
      if (item._id) {
        const i = rows.findIndex((r) => r._id === item._id)
        if (i >= 0) rows[i] = item
        else rows.push(item)
      } else {
        rows.push({ ...item, _id: `id-${idSeq++}` })
      }
    },
  }
  return { backend, rows, calls }
}

test('loadCourseState returns null when the member has no item for the course', async () => {
  const { backend } = fakeBackend()
  assert.equal(await loadCourseState(backend, 'en-uk'), null)
})

test('loadCourseState deserializes a stored state object', async () => {
  const state = newPlayerState()
  state.graduatedIds = ['w1', 'w2']
  const { backend } = fakeBackend([
    { _id: 'x', course: 'en-uk', state: JSON.parse(serializeState(state)) },
  ])
  const loaded = await loadCourseState(backend, 'en-uk')
  assert.ok(loaded)
  assert.equal(loaded!.version, 1)
  assert.deepEqual(loaded!.graduatedIds, ['w1', 'w2'])
})

test('loadCourseState also accepts state stored as a JSON string', async () => {
  const state = newPlayerState()
  const { backend } = fakeBackend([{ _id: 'x', course: 'es-en', state: serializeState(state) }])
  const loaded = await loadCourseState(backend, 'es-en')
  assert.ok(loaded)
  assert.equal(loaded!.version, 1)
})

test('loadCourseState throws on a corrupt stored state', async () => {
  const { backend } = fakeBackend([{ _id: 'x', course: 'en-uk', state: { version: 99 } }])
  let threw = false
  try {
    await loadCourseState(backend, 'en-uk')
  } catch {
    threw = true
  }
  assert.equal(threw, true)
})

test('saveCourseState inserts a new item when none exists', async () => {
  const { backend, rows, calls } = fakeBackend()
  await saveCourseState(backend, 'en-uk', 'member-1', newPlayerState(), '2026-07-08T00:00:00.000Z')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].course, 'en-uk')
  assert.equal(rows[0].memberId, 'member-1')
  assert.equal(rows[0].updatedAt, '2026-07-08T00:00:00.000Z')
  assert.equal(calls.upsert[0]._id, undefined) // insert, not update
})

test('saveCourseState updates the existing item in place (keeps its _id)', async () => {
  const { backend, rows } = fakeBackend([{ _id: 'keep-me', course: 'en-uk', state: JSON.parse(serializeState(newPlayerState())) }])
  const state = newPlayerState()
  state.graduatedIds = ['later']
  await saveCourseState(backend, 'en-uk', 'member-1', state, '2026-07-08T10:00:00.000Z')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]._id, 'keep-me')
  const reread = await loadCourseState(backend, 'en-uk')
  assert.deepEqual(reread!.graduatedIds, ['later'])
})

test('save then load round-trips the state', async () => {
  const { backend } = fakeBackend()
  const state = newPlayerState()
  state.graduatedIds = ['a', 'b', 'c']
  await saveCourseState(backend, 'es-en', 'm', state, '2026-07-08T00:00:00.000Z')
  const loaded = await loadCourseState(backend, 'es-en')
  assert.deepEqual(loaded!.graduatedIds, ['a', 'b', 'c'])
})

test('migrateLocalToCloud uploads local state only when the cloud is empty', async () => {
  const { backend, rows } = fakeBackend()
  const local = newPlayerState()
  local.graduatedIds = ['local']
  const migrated = await migrateLocalToCloud(backend, 'en-uk', 'm', local, '2026-07-08T00:00:00.000Z')
  assert.equal(migrated, true)
  assert.equal(rows.length, 1)
  assert.deepEqual((await loadCourseState(backend, 'en-uk'))!.graduatedIds, ['local'])
})

test('migrateLocalToCloud does NOT overwrite existing cloud progress', async () => {
  const cloud = newPlayerState()
  cloud.graduatedIds = ['cloud']
  const { backend, rows } = fakeBackend([{ _id: 'c', course: 'en-uk', state: JSON.parse(serializeState(cloud)) }])
  const local = newPlayerState()
  local.graduatedIds = ['local']
  const migrated = await migrateLocalToCloud(backend, 'en-uk', 'm', local, '2026-07-08T00:00:00.000Z')
  assert.equal(migrated, false)
  assert.equal(rows.length, 1)
  assert.deepEqual((await loadCourseState(backend, 'en-uk'))!.graduatedIds, ['cloud'])
})
