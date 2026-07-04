import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateCrossword } from './crossword.js'
import { mulberry32 } from './exercises.js'

const POOL = [
  { id: '1', hebrew: 'שלום' },
  { id: '2', hebrew: 'מים' },
  { id: '3', hebrew: 'לחם' },
  { id: '4', hebrew: 'ספר' },
  { id: '5', hebrew: 'ילד' },
  { id: '6', hebrew: 'שמש' },
  { id: '7', hebrew: 'בית' },
  { id: '8', hebrew: 'חלב' },
  { id: '9', hebrew: 'עץ' },
  { id: '10', hebrew: 'תפוח' },
]

test('generateCrossword places several crossing words without conflicts', () => {
  const cw = generateCrossword(POOL, mulberry32(7), 7)
  assert.ok(cw.placements.length >= 4, `placed only ${cw.placements.length}`)
  // rebuild the grid and assert every cell is consistent
  const grid = new Map<string, string>()
  for (const p of cw.placements) {
    p.letters.forEach((letter, i) => {
      const r = p.dir === 'h' ? p.row : p.row + i
      const c = p.dir === 'h' ? p.col + i : p.col
      const key = `${r},${c}`
      if (grid.has(key)) assert.equal(grid.get(key), letter, `conflict at ${key}`)
      grid.set(key, letter)
    })
  }
  // at least one real crossing exists
  const cells = cw.placements.flatMap((p) =>
    p.letters.map((_, i) => (p.dir === 'h' ? `${p.row},${p.col + i}` : `${p.row + i},${p.col}`)),
  )
  assert.ok(cells.length > new Set(cells).size, 'no crossings')
  // normalized bounds
  assert.ok(cw.placements.every((p) => p.row >= 0 && p.col >= 0))
  assert.ok(cw.rows > 0 && cw.cols > 0)
})

test('generateCrossword is deterministic for a given rng seed', () => {
  const a = generateCrossword(POOL, mulberry32(3), 6)
  const b = generateCrossword(POOL, mulberry32(3), 6)
  assert.deepEqual(a, b)
})

test('generateCrossword skips multi-token words', () => {
  const cw = generateCrossword([{ id: 'x', hebrew: 'ארוחת בוקר' }, ...POOL], mulberry32(1), 7)
  assert.ok(!cw.placements.some((p) => p.wordId === 'x'))
})
