// Cloud persistence for Word Castle progress, backed by a Wix Headless CMS
// collection (`progress`, one item per course, author-scoped so each member only
// sees their own). This module is pure: it talks to an injected `ProgressBackend`
// so it can be unit-tested offline. The real backend adapter (Wix @wix/data
// client) lives in wixClient.ts.
import type { GameState } from './game.js'
import { serializeState, deserializeState } from './storage.js'

export interface ProgressItem {
  _id?: string
  memberId?: string
  course?: string
  /** the serialized GameState — stored as a plain object (OBJECT field) or a JSON string */
  state?: unknown
  updatedAt?: string
  [key: string]: unknown
}

export interface ProgressBackend {
  /** the current member's item for this course, or null if none (author-scoped) */
  fetch(course: string): Promise<ProgressItem | null>
  /** insert (no _id) or update (with _id) the member's item */
  upsert(item: ProgressItem): Promise<void>
}

/** Reads and validates the member's saved state for a course. Returns null when
 * nothing is saved yet; throws (like deserializeState) on a corrupt payload. */
export async function loadCourseState(backend: ProgressBackend, course: string): Promise<GameState | null> {
  const item = await backend.fetch(course)
  if (!item || item.state == null) return null
  const json = typeof item.state === 'string' ? item.state : JSON.stringify(item.state)
  return deserializeState(json)
}

/** Upserts the member's state for a course, preserving the existing item's _id. */
export async function saveCourseState(
  backend: ProgressBackend,
  course: string,
  memberId: string,
  state: GameState,
  nowIso: string,
): Promise<void> {
  const existing = await backend.fetch(course)
  const item: ProgressItem = {
    ...(existing?._id ? { _id: existing._id } : {}),
    memberId,
    course,
    state: JSON.parse(serializeState(state)),
    updatedAt: nowIso,
  }
  await backend.upsert(item)
}

/** One-time migration of a local (IndexedDB) save into the cloud on first login:
 * uploads only when the member has no cloud progress for the course yet, so an
 * existing cloud save is never clobbered. Returns whether it uploaded. */
export async function migrateLocalToCloud(
  backend: ProgressBackend,
  course: string,
  memberId: string,
  localState: GameState,
  nowIso: string,
): Promise<boolean> {
  const existing = await backend.fetch(course)
  if (existing) return false
  await saveCourseState(backend, course, memberId, localState, nowIso)
  return true
}
