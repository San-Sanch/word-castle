// Isometric castle board: one SVG scene, tiles painter-ordered back to front.
import type { CastleItem, CastleItemType } from '../lib/types'
import {
  TILE_W,
  TILE_H,
  SpriteDefs,
  WildTile,
  PlotTile,
  PineTree,
  OakTree,
  Rock,
  Flowers,
  GrassTuft,
  WallSprite,
  GateSprite,
  TowerSprite,
  BannerSprite,
  KeepSprite,
  RuinSprite,
} from './sprites'

const SKY_PAD_TOP = 130
const PAD_BOTTOM = 40
const PAD_X = 24

// deterministic wilderness decoration per cell
type Decor = 'pine' | 'oak' | 'rock' | 'flowers' | 'tuft' | 'none'
const DECOR: Decor[] = ['pine', 'none', 'tuft', 'oak', 'none', 'rock', 'flowers', 'none', 'pine', 'none', 'none', 'oak']
function decorFor(x: number, y: number): Decor {
  return DECOR[(x * 7 + y * 13 + ((x * y) % 5)) % DECOR.length]
}

function BuildingSprite({ type }: { type: CastleItemType }) {
  switch (type) {
    case 'wall':
      return <WallSprite />
    case 'gate':
      return <GateSprite />
    case 'tower':
      return <TowerSprite />
    case 'banner':
      return <BannerSprite />
    case 'keep':
      return <KeepSprite />
    case 'land':
      return null
  }
}

export default function CastleBoard(props: {
  grid: number
  castle: CastleItem[]
  placeableAt: (x: number, y: number) => boolean
  placing: boolean
  onCellClick: (x: number, y: number) => void
}) {
  const { grid, castle, placeableAt, placing, onCellClick } = props
  const width = grid * TILE_W + PAD_X * 2
  const height = grid * TILE_H + SKY_PAD_TOP + PAD_BOTTOM
  const originX = width / 2
  const cellPos = (x: number, y: number) => ({
    cx: originX + ((x - y) * TILE_W) / 2,
    cy: SKY_PAD_TOP + ((x + y) * TILE_H) / 2,
  })

  // painter order: back rows first
  const cells: Array<{ x: number; y: number }> = []
  for (let sum = 0; sum <= (grid - 1) * 2; sum++) {
    for (let x = 0; x < grid; x++) {
      const y = sum - x
      if (y >= 0 && y < grid) cells.push({ x, y })
    }
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="board" role="img" aria-label="Castle board">
      <SpriteDefs />
      {cells.map(({ x, y }) => {
        const { cx, cy } = cellPos(x, y)
        const land = castle.find((i) => i.type === 'land' && i.x === x && i.y === y)
        const building = castle.find((i) => i.type !== 'land' && i.x === x && i.y === y)
        const decor = decorFor(x, y)
        const canPlace = placing && placeableAt(x, y)
        return (
          <g
            key={`${x}-${y}`}
            transform={`translate(${cx} ${cy})`}
            className={`iso-cell ${canPlace ? 'placeable' : ''}`}
            onClick={() => onCellClick(x, y)}
          >
            {land ? <PlotTile /> : <WildTile variant={x * 3 + y} />}
            {!land && !building && decor === 'pine' && <PineTree s={0.8 + ((x + y) % 3) * 0.15} />}
            {!land && !building && decor === 'oak' && <OakTree s={0.8 + ((x * y) % 3) * 0.12} />}
            {!land && !building && decor === 'rock' && <Rock />}
            {!land && !building && decor === 'flowers' && <Flowers />}
            {!land && !building && decor === 'tuft' && <GrassTuft />}
            {building && (building.status === 'ruin' ? <RuinSprite /> : <BuildingSprite type={building.type} />)}
            {canPlace && (
              <path
                d={`M 0 ${-2} L ${TILE_W / 2 - 4} ${TILE_H / 2} L 0 ${TILE_H + 2} L ${-TILE_W / 2 + 4} ${TILE_H / 2} Z`}
                className="place-glow"
                fill="none"
                stroke="#f2c94c"
                strokeWidth="3"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Small thumbnail of a shop item, reusing the same sprites. */
export function SpriteThumb({ type, size = 44 }: { type: CastleItemType; size?: number }) {
  const view = type === 'keep' || type === 'tower' ? '-70 -100 140 190' : '-70 -70 140 160'
  return (
    <svg width={size} height={size} viewBox={view} className="thumb">
      <SpriteDefs />
      {type === 'land' ? <PlotTile /> : (
        <g>
          <PlotTile />
          <BuildingSprite type={type} />
        </g>
      )}
    </svg>
  )
}
