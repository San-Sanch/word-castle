// Tiny crossword generator: greedy placement of single-token Hebrew words
// on a shared grid, each new word crossing an already-placed one.

export interface CrosswordPlacement {
  wordId: string
  hebrew: string
  letters: string[]
  row: number
  col: number
  dir: 'h' | 'v'
  num: number
}

export interface Crossword {
  placements: CrosswordPlacement[]
  rows: number
  cols: number
}

interface Cand {
  id: string
  hebrew: string
  letters: string[]
}

export function generateCrossword(
  words: Array<{ id: string; hebrew: string }>,
  rng: () => number,
  maxWords = 7,
): Crossword {
  const cands: Cand[] = words
    .filter((w) => !w.hebrew.includes(' ') && [...w.hebrew].length >= 2)
    .map((w) => ({ id: w.id, hebrew: w.hebrew, letters: [...w.hebrew] }))
  // longest first gives the skeleton more crossing letters; shuffle equals
  const order = cands
    .map((c) => ({ c, key: -c.letters.length + rng() * 0.5 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.c)

  const grid = new Map<string, string>()
  const used = new Map<string, 'h' | 'v'>() // cell -> direction of the word occupying it
  const placements: CrosswordPlacement[] = []

  const cellsOf = (p: { row: number; col: number; dir: 'h' | 'v' }, len: number) =>
    Array.from({ length: len }, (_, i) => ({
      r: p.dir === 'h' ? p.row : p.row + i,
      c: p.dir === 'h' ? p.col + i : p.col,
    }))

  const canPlace = (letters: string[], row: number, col: number, dir: 'h' | 'v'): boolean => {
    let crossings = 0
    const cells = cellsOf({ row, col, dir }, letters.length)
    // cell before/after the word must be empty
    const before = dir === 'h' ? `${row},${col - 1}` : `${row - 1},${col}`
    const after = dir === 'h' ? `${row},${col + letters.length}` : `${row + letters.length},${col}`
    if (grid.has(before) || grid.has(after)) return false
    for (let i = 0; i < letters.length; i++) {
      const { r, c } = cells[i]
      const key = `${r},${c}`
      const existing = grid.get(key)
      if (existing !== undefined) {
        if (existing !== letters[i]) return false
        if (used.get(key) === dir) return false // overlap along the same direction
        crossings++
        continue
      }
      // free cell: perpendicular neighbors must be empty (no side-touching)
      const sides = dir === 'h'
        ? [`${r - 1},${c}`, `${r + 1},${c}`]
        : [`${r},${c - 1}`, `${r},${c + 1}`]
      if (sides.some((s) => grid.has(s))) return false
    }
    return placements.length === 0 || crossings > 0
  }

  const place = (cand: Cand, row: number, col: number, dir: 'h' | 'v') => {
    const cells = cellsOf({ row, col, dir }, cand.letters.length)
    cells.forEach(({ r, c }, i) => {
      const key = `${r},${c}`
      if (!grid.has(key)) used.set(key, dir)
      grid.set(key, cand.letters[i])
    })
    placements.push({ wordId: cand.id, hebrew: cand.hebrew, letters: cand.letters, row, col, dir, num: placements.length + 1 })
  }

  for (const cand of order) {
    if (placements.length >= maxWords) break
    if (placements.length === 0) {
      place(cand, 0, 0, 'h')
      continue
    }
    let done = false
    for (const p of placements) {
      if (done) break
      for (let j = 0; j < p.letters.length && !done; j++) {
        for (let i = 0; i < cand.letters.length && !done; i++) {
          if (p.letters[j] !== cand.letters[i]) continue
          const dir: 'h' | 'v' = p.dir === 'h' ? 'v' : 'h'
          const crossR = p.dir === 'h' ? p.row : p.row + j
          const crossC = p.dir === 'h' ? p.col + j : p.col
          const row = dir === 'v' ? crossR - i : crossR
          const col = dir === 'v' ? crossC : crossC - i
          if (canPlace(cand.letters, row, col, dir)) {
            place(cand, row, col, dir)
            done = true
          }
        }
      }
    }
  }

  // normalize to non-negative coordinates
  let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity
  for (const p of placements) {
    for (const { r, c } of cellsOf(p, p.letters.length)) {
      minR = Math.min(minR, r); maxR = Math.max(maxR, r)
      minC = Math.min(minC, c); maxC = Math.max(maxC, c)
    }
  }
  const shifted = placements.map((p) => ({ ...p, row: p.row - minR, col: p.col - minC }))
  return { placements: shifted, rows: maxR - minR + 1, cols: maxC - minC + 1 }
}
