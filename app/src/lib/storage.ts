import type { GameState } from './game.js'
import { initialGameState, newPlayerState } from './game.js'
import { isGraduated } from './srs.js'

const DB_NAME = 'word-castle'
const STORE = 'state'
const KEY = 'game'

export function serializeState(state: GameState): string {
  return JSON.stringify(state)
}

export function deserializeState(json: string): GameState {
  const raw = JSON.parse(json) as Partial<GameState>
  if (raw.version !== 1) throw new Error(`Unsupported save version: ${String(raw.version)}`)
  const required: Array<keyof GameState> = ['wallet', 'settings', 'reviews', 'castle', 'dayLogs']
  for (const k of required) {
    if (raw[k] === undefined) throw new Error(`Corrupt save: missing ${k}`)
  }
  const defaults = initialGameState()
  // graduation thresholds may have been lowered since the save was written:
  // credit every review state that already clears the current bar
  const savedGraduated = raw.graduatedIds ?? []
  const graduatedIds = [
    ...savedGraduated,
    ...(raw.reviews ?? [])
      .filter((r) => isGraduated(r) && !savedGraduated.includes(r.wordId))
      .map((r) => r.wordId),
  ]
  return {
    ...defaults,
    ...raw,
    version: 1,
    wallet: { ...defaults.wallet, ...raw.wallet },
    settings: {
      ...defaults.settings,
      ...raw.settings,
      exercises: { ...defaults.settings.exercises, ...raw.settings?.exercises },
    },
    // an empty realm has no vision and no build anchor; grant the starting plot
    castle: raw.castle && raw.castle.length > 0 ? raw.castle : newPlayerState().castle,
    graduatedIds,
    guardian: raw.guardian ?? null,
    attacks: raw.attacks ?? [],
    lastRaidCheck: raw.lastRaidCheck ?? null,
    tick: raw.tick ?? 0,
    camps: raw.camps ?? [],
    chestsCollected: raw.chestsCollected ?? [],
    letters: raw.letters ?? [],
    unlockedCategories: raw.unlockedCategories ?? null,
    storyScores: raw.storyScores ?? {},
  } as GameState
}

// ---------- profiles ----------

export interface ProfileMeta {
  id: string
  name: string
  test?: boolean
  createdAt: string
}

const PROFILES_KEY = 'wc-profiles'
const ACTIVE_KEY = 'wc-active-profile'
export const DEFAULT_PROFILE: ProfileMeta = { id: 'main', name: 'Sanch', createdAt: '2026-07-04' }

export function listProfiles(): ProfileMeta[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (raw) {
      const list = JSON.parse(raw) as ProfileMeta[]
      if (Array.isArray(list) && list.length > 0) return list
    }
  } catch {
    // fall through to default
  }
  localStorage.setItem(PROFILES_KEY, JSON.stringify([DEFAULT_PROFILE]))
  return [DEFAULT_PROFILE]
}

export function activeProfileId(): string {
  const id = localStorage.getItem(ACTIVE_KEY)
  const profiles = listProfiles()
  if (id && profiles.some((p) => p.id === id)) return id
  return profiles[0].id
}

export function setActiveProfile(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id)
}

export function createProfile(name: string, test = false): ProfileMeta {
  const profiles = listProfiles()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player'
  let id = slug
  let n = 2
  while (profiles.some((p) => p.id === id)) id = `${slug}-${n++}`
  const meta: ProfileMeta = { id, name, test: test || undefined, createdAt: new Date().toISOString().slice(0, 10) }
  localStorage.setItem(PROFILES_KEY, JSON.stringify([...profiles, meta]))
  return meta
}

export async function deleteProfile(id: string): Promise<void> {
  const remaining = listProfiles().filter((p) => p.id !== id)
  localStorage.setItem(PROFILES_KEY, JSON.stringify(remaining.length ? remaining : [DEFAULT_PROFILE]))
  if (activeProfileId() === id) setActiveProfile(remaining[0]?.id ?? DEFAULT_PROFILE.id)
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(`${KEY}:${id}`)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(db: IDBDatabase, key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as string | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadState(profileId: string): Promise<GameState | null> {
  const db = await openDb()
  try {
    let json = await idbGet(db, `${KEY}:${profileId}`)
    if (!json && profileId === DEFAULT_PROFILE.id) {
      // migrate the pre-profiles save
      const legacy = await idbGet(db, KEY)
      if (legacy) {
        await idbPut(db, `${KEY}:${profileId}`, legacy)
        json = legacy
      }
    }
    return json ? deserializeState(json) : null
  } finally {
    db.close()
  }
}

export async function saveState(profileId: string, state: GameState): Promise<void> {
  const db = await openDb()
  try {
    await idbPut(db, `${KEY}:${profileId}`, serializeState(state))
  } finally {
    db.close()
  }
}
