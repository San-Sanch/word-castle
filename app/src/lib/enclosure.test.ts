import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeProtectedIds } from './enclosure.js'
import type { CastleItem, CastleItemType } from './types.js'

let n = 0
const I = (type: CastleItemType, x: number, y: number, status: 'built' | 'ruin' = 'built'): CastleItem =>
  ({ id: `${type}${x},${y},${n++}`, type, x, y, status, builtAt: '2026-07-01T00:00:00Z' })

// a 3x3 ring of walls around (1,1) with a gate at (1,0)
function ring(withGate: boolean, broken: boolean): CastleItem[] {
  const items: CastleItem[] = []
  for (let x = 0; x <= 2; x++)
    for (let y = 0; y <= 2; y++) {
      if (x === 1 && y === 1) continue
      if (withGate && x === 1 && y === 0) {
        items.push(I('gate', x, y))
        continue
      }
      if (broken && x === 2 && y === 1) continue // hole in the ring
      items.push(I('wall', x, y))
    }
  return items
}

test('building inside a closed ring with a gate is protected', () => {
  const keep = I('keep', 1, 1)
  const items = [...ring(true, false), keep]
  const prot = computeProtectedIds(items)
  assert.ok(prot.has(keep.id))
})

test('broken ring protects nothing', () => {
  const keep = I('keep', 1, 1)
  const items = [...ring(true, true), keep]
  assert.equal(computeProtectedIds(items).has(keep.id), false)
})

test('closed ring without any gate protects nothing', () => {
  const keep = I('keep', 1, 1)
  const items = [...ring(false, false), keep]
  assert.equal(computeProtectedIds(items).has(keep.id), false)
})

test('towers count as wall segments', () => {
  const keep = I('keep', 1, 1)
  const items = [...ring(true, true), I('tower', 2, 1), keep] // hole plugged by tower
  assert.ok(computeProtectedIds(items).has(keep.id))
})

test('ruined wall segment does not block', () => {
  const keep = I('keep', 1, 1)
  const base = ring(true, false).map((i) => (i.x === 0 && i.y === 1 ? { ...i, status: 'ruin' as const } : i))
  assert.equal(computeProtectedIds([...base, keep]).has(keep.id), false)
})

test('building outside the ring is not protected', () => {
  const keep = I('keep', 1, 1)
  const hut = I('woodcutter', 5, 5)
  const items = [...ring(true, false), keep, hut]
  const prot = computeProtectedIds(items)
  assert.ok(prot.has(keep.id))
  assert.equal(prot.has(hut.id), false)
})
