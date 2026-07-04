import type { CastleItem } from './types.js'

const BLOCKING = new Set(['wall', 'gate', 'tower'])

/**
 * A building is protected when enemies cannot reach it: flood fill from its tile
 * (4-directional, through tiles not blocked by built walls/gates/towers) never
 * escapes the walls' bounding box, AND the enclosing ring contains at least one
 * gate (a fortress you cannot enter or leave protects nobody).
 */
export function computeProtectedIds(items: CastleItem[]): Set<string> {
  const built = items.filter((i) => i.status === 'built')
  const blockers = new Map<string, CastleItem>()
  for (const i of built) if (BLOCKING.has(i.type)) blockers.set(`${i.x},${i.y}`, i)

  if (blockers.size === 0) return new Set()

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const b of blockers.values()) {
    minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x)
    minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y)
  }
  // one-tile margin: reaching it means the fill escaped the walls
  minX -= 1; maxX += 1; minY -= 1; maxY += 1

  const result = new Set<string>()
  const candidates = built.filter((i) => !BLOCKING.has(i.type) && i.type !== 'land')
  const regionCache = new Map<string, { closed: boolean; hasGate: boolean }>()

  for (const item of candidates) {
    const startKey = `${item.x},${item.y}`
    if (blockers.has(startKey)) continue
    let info = regionCache.get(startKey)
    if (!info) {
      // flood fill
      const seen = new Set<string>([startKey])
      const queue: Array<[number, number]> = [[item.x, item.y]]
      let closed = true
      let hasGate = false
      while (queue.length) {
        const [x, y] = queue.pop()!
        if (x <= minX || x >= maxX || y <= minY || y >= maxY) {
          closed = false
          continue
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy
          const key = `${nx},${ny}`
          const blocker = blockers.get(key)
          if (blocker) {
            if (blocker.type === 'gate') hasGate = true
            continue
          }
          if (!seen.has(key)) {
            seen.add(key)
            queue.push([nx, ny])
          }
        }
      }
      info = { closed, hasGate }
      for (const key of seen) regionCache.set(key, info)
    }
    if (info.closed && info.hasGate) result.add(item.id)
  }
  return result
}
