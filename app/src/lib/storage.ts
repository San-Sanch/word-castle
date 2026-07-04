import type { GameState } from './game.js'
import { initialGameState } from './game.js'

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
  return {
    ...defaults,
    ...raw,
    version: 1,
    graduatedIds: raw.graduatedIds ?? [],
    guardian: raw.guardian ?? null,
    attacks: raw.attacks ?? [],
    lastRaidCheck: raw.lastRaidCheck ?? null,
  } as GameState
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

export async function loadState(): Promise<GameState | null> {
  const db = await openDb()
  try {
    const json = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result as string | undefined)
      req.onerror = () => reject(req.error)
    })
    return json ? deserializeState(json) : null
  } finally {
    db.close()
  }
}

export async function saveState(state: GameState): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(serializeState(state), KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
