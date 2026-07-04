// The world: an infinite isometric map with fog of war.
// Drag to pan; tiles render only inside the viewport radius; the fog hides
// everything outside vision range of your buildings.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Camp, CastleItem, CastleItemType } from '../lib/types'
import { terrainAt, hasChestAt, visionSet, isVisible } from '../lib/world'
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
  RiverTile,
  MountainTile,
  FogTile,
  RoadSprite,
  BridgeSprite,
  FieldSprite,
  WoodcutterSprite,
  QuarrySprite,
  CampSprite,
  ChestSprite,
  WallSprite,
  GateSprite,
  TowerSprite,
  BannerSprite,
  KeepSprite,
  RuinSprite,
} from './sprites'

const VIEW_W = 1160
const VIEW_H = 720
const RENDER_RADIUS = 12 // tiles rendered around the view center

type Decor = 'pine' | 'oak' | 'rock' | 'flowers' | 'tuft' | 'none'
const DECOR: Decor[] = ['pine', 'none', 'tuft', 'oak', 'none', 'rock', 'flowers', 'none', 'pine', 'none', 'none', 'oak']
function decorFor(x: number, y: number): Decor {
  const h = ((x * 374761393) ^ (y * 668265263)) >>> 0
  return DECOR[h % DECOR.length]
}

export function BuildingSprite({ type, roadMask, bridgeAxis }: {
  type: CastleItemType
  roadMask?: { n: boolean; e: boolean; s: boolean; w: boolean }
  bridgeAxis?: 'ew' | 'ns'
}) {
  switch (type) {
    case 'wall': return <WallSprite />
    case 'gate': return <GateSprite />
    case 'tower': return <TowerSprite />
    case 'banner': return <BannerSprite />
    case 'keep': return <KeepSprite />
    case 'road': return <RoadSprite {...(roadMask ?? { n: false, e: false, s: false, w: false })} />
    case 'bridge': return <BridgeSprite axis={bridgeAxis ?? 'ew'} />
    case 'field': return <FieldSprite />
    case 'woodcutter': return <WoodcutterSprite />
    case 'quarry': return <QuarrySprite />
    case 'land': return null
  }
}

export default function WorldBoard(props: {
  castle: CastleItem[]
  camps: Camp[]
  chestsCollected: string[]
  placing: boolean
  placeableAt: (x: number, y: number) => boolean
  onCellClick: (x: number, y: number) => void
  recenterSignal: number
}) {
  const { castle, camps, chestsCollected, placing, placeableAt, onCellClick, recenterSignal } = props

  const home = useMemo(() => {
    // the keep is home; before that, the starting plot; last resort: first item
    const anchor =
      castle.find((i) => i.type === 'keep') ??
      castle.find((i) => i.type === 'land') ??
      castle[0]
    return anchor ? { x: anchor.x, y: anchor.y } : { x: 3, y: 3 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterSignal, castle.length === 0])

  // pan in screen px; 0,0 puts the home tile at the viewport center
  const [pan, setPan] = useState({ x: 0, y: 0 })
  useEffect(() => setPan({ x: 0, y: 0 }), [recenterSignal])

  const vision = useMemo(() => visionSet(castle), [castle])
  const itemAt = useMemo(() => {
    const m = new Map<string, CastleItem[]>()
    for (const i of castle) {
      const k = `${i.x},${i.y}`
      m.set(k, [...(m.get(k) ?? []), i])
    }
    return m
  }, [castle])

  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; moved: number; panStart: { x: number; y: number } } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: 0, panStart: pan }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const scale = svgRef.current ? VIEW_W / svgRef.current.getBoundingClientRect().width : 1
    const dx = (e.clientX - drag.current.x) * scale
    const dy = (e.clientY - drag.current.y) * scale
    drag.current.moved = Math.max(drag.current.moved, Math.abs(dx) + Math.abs(dy))
    setPan({ x: drag.current.panStart.x + dx, y: drag.current.panStart.y + dy })
  }
  const onPointerUp = () => {
    // keep drag info briefly so cell clicks can tell drags from taps
    const d = drag.current
    drag.current = null
    lastDragMoved.current = d?.moved ?? 0
  }
  const lastDragMoved = useRef(0)

  const clickCell = (x: number, y: number) => {
    if (lastDragMoved.current > 8) return // that was a pan, not a tap
    onCellClick(x, y)
  }

  // view center in tile coords, derived from pan
  const centerTile = {
    x: home.x - Math.round((pan.x / TILE_W + pan.y / TILE_H)),
    y: home.y - Math.round((pan.y / TILE_H - pan.x / TILE_W)),
  }

  const originX = VIEW_W / 2 + pan.x - ((home.x - home.y) * TILE_W) / 2
  const originY = VIEW_H / 2 + pan.y - ((home.x + home.y) * TILE_H) / 2

  // painter order within render window
  const cells: Array<{ x: number; y: number }> = []
  const R = RENDER_RADIUS
  for (let sum = centerTile.x + centerTile.y - R * 2; sum <= centerTile.x + centerTile.y + R * 2; sum++) {
    for (let x = centerTile.x - R * 2; x <= centerTile.x + R * 2; x++) {
      const y = sum - x
      if (Math.abs(x - centerTile.x) + Math.abs(y - centerTile.y) <= R * 2) {
        // keep only tiles that project inside the viewport (with margin)
        const sx = originX + ((x - y) * TILE_W) / 2
        const sy = originY + ((x + y) * TILE_H) / 2
        if (sx > -TILE_W && sx < VIEW_W + TILE_W && sy > -TILE_H * 3 && sy < VIEW_H + TILE_H * 2) {
          cells.push({ x, y })
        }
      }
    }
  }

  const campAt = (x: number, y: number): Camp | undefined => camps.find((c) => c.x === x && c.y === y)
  const roadLike = (x: number, y: number) =>
    (itemAt.get(`${x},${y}`) ?? []).some((i) => (i.type === 'road' || i.type === 'bridge' || i.type === 'gate') && i.status === 'built')

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="board world"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <SpriteDefs />
      {cells.map(({ x, y }) => {
        const sx = originX + ((x - y) * TILE_W) / 2
        const sy = originY + ((x + y) * TILE_H) / 2
        const visible = isVisible(x, y, vision)
        if (!visible) {
          return (
            <g key={`${x}:${y}`} transform={`translate(${sx} ${sy})`}>
              <FogTile />
            </g>
          )
        }
        const terrain = terrainAt(x, y)
        const here = itemAt.get(`${x},${y}`) ?? []
        const building = here.find((i) => i.type !== 'land')
        const land = here.find((i) => i.type === 'land')
        const camp = campAt(x, y)
        const chest = hasChestAt(x, y) && !chestsCollected.includes(`${x},${y}`)
        const decor = decorFor(x, y)
        const canPlace = placing && placeableAt(x, y)
        return (
          <g key={`${x}:${y}`} transform={`translate(${sx} ${sy})`} className={`iso-cell ${canPlace ? 'placeable' : ''}`} onClick={() => clickCell(x, y)}>
            {terrain === 'river' && !building && <RiverTile variant={(x + y) & 1} />}
            {terrain === 'river' && building && <RiverTile variant={(x + y) & 1} />}
            {terrain === 'mountain' && <MountainTile />}
            {terrain !== 'river' && terrain !== 'mountain' && (land ? <PlotTile /> : <WildTile variant={((x % 4) + 4 + ((y % 3) + 3)) % 4} />)}
            {terrain === 'forest' && !building && (
              <>
                <g transform="translate(-22 -6)"><PineTree s={0.75} /></g>
                <g transform="translate(20 4)"><PineTree s={0.9} /></g>
              </>
            )}
            {terrain === 'grass' && !building && !land && !camp && !chest && (
              <>
                {decor === 'pine' && <PineTree s={0.85} />}
                {decor === 'oak' && <OakTree s={0.85} />}
                {decor === 'rock' && <Rock />}
                {decor === 'flowers' && <Flowers />}
                {decor === 'tuft' && <GrassTuft />}
              </>
            )}
            {building && (building.status === 'ruin' ? (
              <RuinSprite />
            ) : (
              <BuildingSprite
                type={building.type}
                roadMask={{
                  n: roadLike(x, y - 1),
                  e: roadLike(x + 1, y),
                  s: roadLike(x, y + 1),
                  w: roadLike(x - 1, y),
                }}
                bridgeAxis={roadLike(x + 1, y) || roadLike(x - 1, y) || terrainAt(x + 1, y) !== 'river' ? 'ew' : 'ns'}
              />
            ))}
            {chest && <ChestSprite />}
            {camp && <CampSprite />}
            {canPlace && (
              <path
                d={`M 0 -2 L ${TILE_W / 2 - 4} ${TILE_H / 2} L 0 ${TILE_H + 2} L ${-TILE_W / 2 + 4} ${TILE_H / 2} Z`}
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

/** Small thumbnail of a build-menu item, reusing the same sprites. */
export function SpriteThumb({ type, size = 44 }: { type: CastleItemType; size?: number }) {
  const tall = type === 'keep' || type === 'tower'
  const view = tall ? '-70 -110 140 200' : '-70 -60 140 150'
  return (
    <svg width={size} height={size} viewBox={view} className="thumb">
      <SpriteDefs />
      {type === 'bridge' ? (
        <g><RiverTile /><BridgeSprite axis="ew" /></g>
      ) : type === 'road' ? (
        <g><PlotTile /><RoadSprite n={false} e={true} s={false} w={true} /></g>
      ) : type === 'land' ? (
        <PlotTile />
      ) : (
        <g><PlotTile /><BuildingSprite type={type} /></g>
      )}
    </svg>
  )
}
