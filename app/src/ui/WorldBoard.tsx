// The world: an infinite isometric map with fog of war and zoom.
// Drag to pan, wheel or buttons to zoom. Unexplored terrain renders as a dark
// silhouette map; full color (and enemies, chests, decorations) only inside
// the vision range of your buildings.
import { useMemo, useRef, useState } from 'react'
import type { Camp, CastleItem, CastleItemType, Terrain } from '../lib/types'
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
const MIN_ZOOM = 0.45
const MAX_ZOOM = 1.7
const CENTER_SNAP = 4 // re-cull the tile set every N tiles of panning

type Decor = 'pine' | 'oak' | 'rock' | 'flowers' | 'tuft' | 'none'
const DECOR: Decor[] = ['pine', 'none', 'tuft', 'oak', 'none', 'rock', 'flowers', 'none', 'pine', 'none', 'none', 'oak']
function decorFor(x: number, y: number): Decor {
  const h = ((x * 374761393) ^ (y * 668265263)) >>> 0
  return DECOR[h % DECOR.length]
}

const isoX = (x: number, y: number) => ((x - y) * TILE_W) / 2
const isoY = (x: number, y: number) => ((x + y) * TILE_H) / 2

/** Dark silhouette of unexplored terrain: the shape of the world, no details. */
function FogTerrain({ terrain }: { terrain: Terrain }) {
  const fill =
    terrain === 'river' ? '#13253a' : terrain === 'mountain' ? '#20222a' : terrain === 'forest' ? '#13211a' : '#141e21'
  const d = `M 0 0 L ${TILE_W / 2} ${TILE_H / 2} L 0 ${TILE_H} L ${-TILE_W / 2} ${TILE_H / 2} Z`
  return (
    <g>
      <path d={d} fill={fill} />
      {terrain === 'mountain' && (
        <polygon points={`-14,${TILE_H / 2 + 9} 0,${TILE_H / 2 - 16} 13,${TILE_H / 2 + 9}`} fill="#2a2d36" />
      )}
      {terrain === 'forest' && (
        <polygon points={`-8,${TILE_H / 2 + 8} 0,${TILE_H / 2 - 12} 8,${TILE_H / 2 + 8}`} fill="#1b2c22" />
      )}
    </g>
  )
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
    const anchor =
      castle.find((i) => i.type === 'keep') ??
      castle.find((i) => i.type === 'land') ??
      castle[0]
    return anchor ? { x: anchor.x, y: anchor.y } : { x: 3, y: 3 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterSignal, castle.length === 0])

  // camera: pan in screen px relative to home, zoom multiplies world px
  const [camera, setCamera] = useState({ panX: 0, panY: 0, zoom: 1 })
  const lastRecenter = useRef(recenterSignal)
  if (lastRecenter.current !== recenterSignal) {
    lastRecenter.current = recenterSignal
    if (camera.panX !== 0 || camera.panY !== 0) setCamera((c) => ({ ...c, panX: 0, panY: 0 }))
  }

  const homePx = { x: isoX(home.x, home.y), y: isoY(home.x, home.y) + TILE_H / 2 }

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
  const drag = useRef<{ x: number; y: number; moved: number; start: { panX: number; panY: number } } | null>(null)
  const lastDragMoved = useRef(0)

  const screenScale = () => (svgRef.current ? VIEW_W / svgRef.current.getBoundingClientRect().width : 1)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: 0, start: { panX: camera.panX, panY: camera.panY } }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const s = screenScale()
    const dx = (e.clientX - drag.current.x) * s
    const dy = (e.clientY - drag.current.y) * s
    drag.current.moved = Math.max(drag.current.moved, Math.abs(dx) + Math.abs(dy))
    setCamera((c) => ({ ...c, panX: drag.current!.start.panX + dx, panY: drag.current!.start.panY + dy }))
  }
  const onPointerUp = () => {
    lastDragMoved.current = drag.current?.moved ?? 0
    drag.current = null
  }

  const applyZoom = (factor: number) => {
    setCamera((c) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor))
      const ratio = zoom / c.zoom
      // keep the viewport center fixed while zooming
      return { zoom, panX: c.panX * ratio, panY: c.panY * ratio }
    })
  }
  const onWheel = (e: React.WheelEvent) => {
    applyZoom(e.deltaY > 0 ? 0.88 : 1.14)
  }

  const clickCell = (x: number, y: number) => {
    if (lastDragMoved.current > 8) return // that was a pan, not a tap
    onCellClick(x, y)
  }

  // world-px point currently at the viewport center
  const centerWorld = {
    x: homePx.x - camera.panX / camera.zoom,
    y: homePx.y - camera.panY / camera.zoom,
  }
  // snap the culling center so the tile set is stable while panning smoothly
  const snap = CENTER_SNAP * TILE_W
  const cullCx = Math.round(centerWorld.x / snap) * snap
  const cullCy = Math.round(centerWorld.y / snap) * snap
  const halfW = VIEW_W / 2 / camera.zoom + snap + TILE_W
  const halfH = VIEW_H / 2 / camera.zoom + snap + TILE_H * 3

  const scene = useMemo(() => {
    const cells: React.ReactNode[] = []
    const vMin = Math.floor((cullCy - halfH) / (TILE_H / 2))
    const vMax = Math.ceil((cullCy + halfH) / (TILE_H / 2))
    const uMin = Math.floor((cullCx - halfW) / (TILE_W / 2))
    const uMax = Math.ceil((cullCx + halfW) / (TILE_W / 2))
    for (let v = vMin; v <= vMax; v++) {
      for (let u = uMin; u <= uMax; u++) {
        if ((u + v) % 2 !== 0) continue
        const x = (u + v) / 2
        const y = (v - u) / 2
        const sx = isoX(x, y)
        const sy = isoY(x, y)
        const visible = isVisible(x, y, vision)
        const terrain = terrainAt(x, y)
        if (!visible) {
          cells.push(
            <g key={`${x}:${y}`} transform={`translate(${sx} ${sy})`}>
              <FogTerrain terrain={terrain} />
            </g>,
          )
          continue
        }
        const here = itemAt.get(`${x},${y}`) ?? []
        const building = here.find((i) => i.type !== 'land')
        const land = here.find((i) => i.type === 'land')
        const camp = camps.find((c) => c.x === x && c.y === y)
        const chest = hasChestAt(x, y) && !chestsCollected.includes(`${x},${y}`)
        const decor = decorFor(x, y)
        const canPlace = placing && placeableAt(x, y)
        const roadLike = (ax: number, ay: number) =>
          (itemAt.get(`${ax},${ay}`) ?? []).some((i) => (i.type === 'road' || i.type === 'bridge' || i.type === 'gate') && i.status === 'built')
        cells.push(
          <g key={`${x}:${y}`} transform={`translate(${sx} ${sy})`} className={`iso-cell ${canPlace ? 'placeable' : ''}`} onClick={() => clickCell(x, y)}>
            {terrain === 'river' && <RiverTile variant={(x + y) & 1} />}
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
          </g>,
        )
      }
    }
    return cells
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cullCx, cullCy, halfW, halfH, vision, itemAt, camps, chestsCollected, placing, placeableAt])

  const tx = VIEW_W / 2 + camera.panX - homePx.x * camera.zoom
  const ty = VIEW_H / 2 + camera.panY - homePx.y * camera.zoom

  return (
    <div className="board-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="board world"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        <SpriteDefs />
        <g transform={`translate(${tx} ${ty}) scale(${camera.zoom})`}>{scene}</g>
      </svg>
      <div className="zoom-controls">
        <button className="ghost" onClick={() => applyZoom(1.25)} title="Zoom in">＋</button>
        <button className="ghost" onClick={() => applyZoom(0.8)} title="Zoom out">－</button>
      </div>
    </div>
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
