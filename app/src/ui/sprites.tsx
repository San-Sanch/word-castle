// Hand-drawn isometric SVG sprites for the castle board.
// Every sprite is drawn in a local coordinate system where (0,0) is the TOP
// vertex of its ground diamond; the diamond is TILE_W wide and TILE_H tall.
// Light comes from the upper left: left faces are lighter than right faces.

export const TILE_W = 120
export const TILE_H = 60

const W2 = TILE_W / 2
const H2 = TILE_H / 2

/** Diamond path of the ground tile: top -> right -> bottom -> left. */
const diamond = (w = TILE_W, h = TILE_H, cx = 0, cy = 0) =>
  `M ${cx} ${cy - h / 2} L ${cx + w / 2} ${cy} L ${cx} ${cy + h / 2} L ${cx - w / 2} ${cy} Z`

// ---------- ground ----------

const GRASS_WILD = ['#2e5231', '#2b4d2e', '#315635', '#2d5032']
const GRASS_PLOT = '#4f7a38'

export function WildTile({ variant }: { variant: number }) {
  return (
    <g>
      <path className="tile-top" d={diamond(TILE_W, TILE_H, 0, H2)} fill={GRASS_WILD[variant % GRASS_WILD.length]} />
      <path d={diamond(TILE_W, TILE_H, 0, H2)} fill="none" stroke="#1c3520" strokeWidth="1" opacity="0.6" />
    </g>
  )
}

export function PlotTile() {
  return (
    <g>
      <path className="tile-top" d={diamond(TILE_W, TILE_H, 0, H2)} fill={GRASS_PLOT} />
      {/* mown stripes */}
      <path d={`M 0 ${H2 - 20} L ${W2 - 20} ${H2 - 20 + (W2 - 20) / 2}`} stroke="#5b8a41" strokeWidth="7" opacity="0.8" strokeLinecap="round" transform="translate(-14,7)" />
      <path d={`M 0 ${H2 - 20} L ${W2 - 20} ${H2 - 20 + (W2 - 20) / 2}`} stroke="#5b8a41" strokeWidth="7" opacity="0.8" strokeLinecap="round" transform="translate(-34,17)" />
      <path d={diamond(TILE_W, TILE_H, 0, H2)} fill="none" stroke="#e8d9a0" strokeWidth="2" opacity="0.55" />
    </g>
  )
}

// ---------- nature decorations ----------

export function PineTree({ s = 1 }: { s?: number }) {
  return (
    <g transform={`translate(0 ${H2}) scale(${s})`}>
      <ellipse cx="0" cy="8" rx="20" ry="7" fill="#000" opacity="0.25" />
      <rect x="-3" y="-4" width="6" height="12" fill="#5d4023" />
      <polygon points="0,-58 20,-18 -20,-18" fill="#2f6b3a" />
      <polygon points="0,-58 20,-18 0,-18" fill="#265a30" />
      <polygon points="0,-70 15,-38 -15,-38" fill="#357748" />
      <polygon points="0,-70 15,-38 0,-38" fill="#2b6339" />
      <polygon points="0,-84 11,-58 -11,-58" fill="#3d8352" />
      <polygon points="0,-84 11,-58 0,-58" fill="#316e42" />
    </g>
  )
}

export function OakTree({ s = 1 }: { s?: number }) {
  return (
    <g transform={`translate(0 ${H2}) scale(${s})`}>
      <ellipse cx="0" cy="8" rx="22" ry="8" fill="#000" opacity="0.25" />
      <rect x="-4" y="-10" width="8" height="18" fill="#6b4a28" />
      <circle cx="-12" cy="-26" r="16" fill="#3d7a3f" />
      <circle cx="12" cy="-24" r="15" fill="#356b38" />
      <circle cx="0" cy="-40" r="18" fill="#468a49" />
      <circle cx="6" cy="-36" r="10" fill="#3d7a3f" opacity="0.7" />
      <circle cx="-6" cy="-44" r="6" fill="#54a057" opacity="0.8" />
    </g>
  )
}

export function Rock() {
  return (
    <g transform={`translate(0 ${H2})`}>
      <ellipse cx="0" cy="6" rx="18" ry="6" fill="#000" opacity="0.22" />
      <polygon points="-16,4 -10,-12 4,-16 14,-6 12,4" fill="#8b8f96" />
      <polygon points="4,-16 14,-6 12,4 2,4" fill="#6f737a" />
      <polygon points="-10,-12 -2,-14 0,-6 -8,-4" fill="#a3a7ad" />
      <polygon points="-22,6 -16,-2 -8,0 -10,6" fill="#7c8087" />
    </g>
  )
}

export function Flowers() {
  const F = ({ x, y, c }: { x: number; y: number; c: string }) => (
    <g transform={`translate(${x} ${y})`}>
      <line x1="0" y1="0" x2="0" y2="-7" stroke="#3a6b33" strokeWidth="1.5" />
      <circle cx="0" cy="-9" r="3.2" fill={c} />
      <circle cx="0" cy="-9" r="1.2" fill="#f5d442" />
    </g>
  )
  return (
    <g transform={`translate(0 ${H2})`}>
      <F x={-16} y={2} c="#e06d6d" />
      <F x={-2} y={8} c="#e9e9ef" />
      <F x={12} y={0} c="#c77dd6" />
      <F x={2} y={-6} c="#e0a13f" />
    </g>
  )
}

export function GrassTuft() {
  return (
    <g transform={`translate(0 ${H2})`} stroke="#5d8f3f" strokeWidth="2.5" strokeLinecap="round" fill="none">
      <path d="M -8 6 C -10 -4 -14 -8 -16 -10" />
      <path d="M -2 8 C -2 -4 -4 -10 -3 -14" />
      <path d="M 4 6 C 6 -2 10 -8 13 -10" />
    </g>
  )
}

// ---------- building helpers ----------

/**
 * Extruded iso box on this tile.
 * fw = footprint fraction of the tile, h = wall height, z = lift above ground.
 */
function IsoBox(props: { fw?: number; h: number; z?: number; top: string; left: string; right: string; stroke?: string }) {
  const { fw = 0.72, h, z = 0, top, left, right, stroke = '#26221c' } = props
  const w = W2 * fw
  const d = H2 * fw
  const cy = H2 - z // center of footprint diamond at ground level
  return (
    <g stroke={stroke} strokeWidth="1" strokeLinejoin="round">
      {/* left face */}
      <polygon points={`${-w},${cy} 0,${cy + d} 0,${cy + d - h} ${-w},${cy - h}`} fill={left} />
      {/* right face */}
      <polygon points={`${w},${cy} 0,${cy + d} 0,${cy + d - h} ${w},${cy - h}`} fill={right} />
      {/* top face */}
      <path d={diamond(w * 2, d * 2, 0, cy - h)} fill={top} />
    </g>
  )
}

const STONE = { top: '#b9b2a4', left: '#a49c8c', right: '#7f7869', line: '#5f594d' }

/** Small crenellation cubes along the front edges of a stone top. */
function Merlons({ z, fw = 0.72 }: { z: number; fw?: number }) {
  const w = W2 * fw
  const d = H2 * fw
  const cy = H2 - z
  const cube = (t: number, side: 1 | -1) => {
    // position along front-left (side=-1) / front-right (side=1) top edge
    const x = side * w * t
    const y = cy + d * (1 - t)
    return (
      <g key={`${side}${t}`}>
        <polygon points={`${x - 5},${y - 10} ${x + 5},${y - 10} ${x + 5},${y - 2} ${x - 5},${y - 2}`} fill={side === -1 ? STONE.left : STONE.right} stroke="#5f594d" strokeWidth="0.8" />
        <polygon points={`${x - 5},${y - 10} ${x + 5},${y - 10} ${x + 8},${y - 13} ${x - 2},${y - 13}`} fill={STONE.top} stroke="#5f594d" strokeWidth="0.8" />
      </g>
    )
  }
  return <g>{[0.35, 0.75].map((t) => cube(t, -1))}{[0.35, 0.75].map((t) => cube(t, 1))}</g>
}

function StoneJoints({ h, z = 0, fw = 0.72 }: { h: number; z?: number; fw?: number }) {
  const w = W2 * fw
  const d = H2 * fw
  const cy = H2 - z
  const rows = Math.floor(h / 12)
  return (
    <g stroke={STONE.line} strokeWidth="0.8" opacity="0.5">
      {Array.from({ length: rows }, (_, i) => {
        const y = 10 + i * 12
        return (
          <g key={i}>
            <line x1={-w} y1={cy - y} x2={0} y2={cy + d - y} />
            <line x1={w} y1={cy - y} x2={0} y2={cy + d - y} />
          </g>
        )
      })}
    </g>
  )
}

// ---------- buildings ----------

export function WallSprite() {
  return (
    <g>
      <ellipse cx="0" cy={H2 + 6} rx="42" ry="14" fill="#000" opacity="0.18" />
      <IsoBox h={30} top={STONE.top} left={STONE.left} right={STONE.right} />
      <StoneJoints h={30} />
      <Merlons z={30} />
    </g>
  )
}

export function GateSprite() {
  return (
    <g>
      <ellipse cx="0" cy={H2 + 6} rx="44" ry="15" fill="#000" opacity="0.18" />
      <IsoBox h={42} top={STONE.top} left={STONE.left} right={STONE.right} />
      <StoneJoints h={42} />
      <Merlons z={42} />
      {/* arched wooden door on the front-left face */}
      <g transform={`translate(-22 ${H2 + 8})`}>
        <path d="M -12 0 L -12 -20 Q 0 -32 12 -14 L 12 6 L 0 12 Z" fill="#7a5226" stroke="#4a3115" strokeWidth="1.5" transform="skewY(0)" />
        <line x1="-4" y1="-26" x2="-4" y2="6" stroke="#5d3d1a" strokeWidth="1.5" />
        <line x1="4" y1="-24" x2="4" y2="9" stroke="#5d3d1a" strokeWidth="1.5" />
        <line x1="-12" y1="-12" x2="12" y2="-6" stroke="#3f2a12" strokeWidth="2" />
        <circle cx="8" cy="-2" r="1.8" fill="#d9c26a" />
      </g>
    </g>
  )
}

export function TowerSprite() {
  return (
    <g transform={`translate(0 ${H2})`}>
      <ellipse cx="0" cy="8" rx="30" ry="11" fill="#000" opacity="0.2" />
      {/* cylinder body */}
      <path d="M -20 2 L -20 -62 L 20 -62 L 20 2 A 20 8 0 0 1 -20 2 Z" fill="url(#towerGrad)" stroke="#5f594d" strokeWidth="1" />
      {/* battlement ring */}
      <ellipse cx="0" cy="-62" rx="24" ry="9" fill="#b9b2a4" stroke="#5f594d" strokeWidth="1" />
      {Array.from({ length: 5 }, (_, i) => {
        const a = -Math.PI + (i / 4) * Math.PI
        const x = Math.cos(a) * 22
        const y = -64 + Math.sin(a) * 8
        return <rect key={i} x={x - 4} y={y - 8} width="8" height="10" fill={x < 0 ? '#a49c8c' : '#8a8375'} stroke="#5f594d" strokeWidth="0.8" />
      })}
      <ellipse cx="0" cy="-64" rx="16" ry="6" fill="#8f8878" />
      {/* arrow slit + flag */}
      <rect x="-2.5" y="-48" width="5" height="14" rx="2.5" fill="#3d382f" />
      <line x1="0" y1="-64" x2="0" y2="-88" stroke="#4a3115" strokeWidth="2.5" />
      <path d="M 1 -88 L 22 -82 L 1 -76 Z" fill="#d64545" />
    </g>
  )
}

export function BannerSprite() {
  return (
    <g transform={`translate(0 ${H2})`}>
      <ellipse cx="0" cy="6" rx="12" ry="5" fill="#000" opacity="0.22" />
      <polygon points="-8,4 -2,-4 6,0 2,6" fill="#8b8f96" />
      <line x1="0" y1="2" x2="0" y2="-58" stroke="#4a3115" strokeWidth="3" />
      <circle cx="0" cy="-60" r="3" fill="#d9a834" />
      <path d="M 2 -56 C 16 -54 20 -50 30 -52 L 26 -42 C 18 -44 12 -40 2 -42 Z" fill="#d9a834" />
      <path d="M 2 -56 C 16 -54 20 -50 30 -52 L 28 -47 C 19 -48 13 -46 2 -49 Z" fill="#e8bf55" />
    </g>
  )
}

export function KeepSprite() {
  const fw = 0.78
  const w = W2 * fw
  const d = H2 * fw
  const hallH = 46
  const cy = H2
  const apexY = cy - hallH - 34 // roof apex above footprint center
  return (
    <g>
      <ellipse cx="0" cy={H2 + 8} rx="52" ry="17" fill="#000" opacity="0.2" />
      {/* main hall */}
      <IsoBox fw={fw} h={hallH} top={STONE.top} left={STONE.left} right={STONE.right} />
      <StoneJoints h={hallH} fw={fw} />
      {/* pitched roof: left and right faces to the apex */}
      <g stroke="#5a2721" strokeWidth="1" strokeLinejoin="round">
        <polygon points={`${-w},${cy - hallH} 0,${cy + d - hallH} 0,${apexY}`} fill="#b0574a" />
        <polygon points={`${w},${cy - hallH} 0,${cy + d - hallH} 0,${apexY}`} fill="#8c4038" />
        <polygon points={`${-w},${cy - hallH} 0,${cy - d - hallH} 0,${apexY}`} fill="#c46355" opacity="0.9" />
        <polygon points={`${w},${cy - hallH} 0,${cy - d - hallH} 0,${apexY}`} fill="#9c4a40" opacity="0.9" />
      </g>
      {/* flag on the apex */}
      <line x1="0" y1={apexY} x2="0" y2={apexY - 22} stroke="#4a3115" strokeWidth="2.5" />
      <path d={`M 1 ${apexY - 22} L 20 ${apexY - 16.5} L 1 ${apexY - 11} Z`} fill="#d64545" />
      {/* front corner turrets, drawn after the hall so they stand proud */}
      <g transform={`translate(${-W2 * 0.52} ${H2 * 0.3}) scale(0.52)`}>
        <TowerSprite />
      </g>
      <g transform={`translate(${W2 * 0.52} ${H2 * 0.3}) scale(0.52)`}>
        <TowerSprite />
      </g>
      {/* door + window on the front faces */}
      <g transform={`translate(-14 ${H2 + 14})`}>
        <path d="M -8 0 L -8 -14 Q 0 -22 8 -10 L 8 4 L 0 8 Z" fill="#7a5226" stroke="#4a3115" strokeWidth="1.2" />
        <line x1="0" y1="-18" x2="0" y2="6" stroke="#5d3d1a" strokeWidth="1.2" />
      </g>
      <rect x="16" y={H2 - 34} width="6" height="10" rx="3" fill="#3d382f" />
    </g>
  )
}

export function RuinSprite() {
  return (
    <g>
      <ellipse cx="0" cy={H2 + 6} rx="42" ry="14" fill="#000" opacity="0.18" />
      {/* broken wall stumps */}
      <g stroke="#4c463c" strokeWidth="1" strokeLinejoin="round">
        <polygon points={`${-W2 * 0.7},${H2} 0,${H2 * 1.7} 0,${H2 * 1.7 - 14} ${-W2 * 0.7},${H2 - 22}`} fill="#78715f" />
        <polygon points={`${W2 * 0.7},${H2} 0,${H2 * 1.7} 0,${H2 * 1.7 - 10} ${W2 * 0.7},${H2 - 16}`} fill="#645e4e" />
        <polygon points={`${-W2 * 0.7},${H2 - 22} -20,${H2 - 6} 0,${H2 * 1.7 - 14} 0,${H2 * 1.7 - 20}`} fill="#8a8271" />
      </g>
      {/* rubble */}
      <g transform={`translate(0 ${H2})`}>
        <polygon points="-6,10 0,2 8,6 4,12" fill="#8b8474" />
        <polygon points="10,4 16,-2 22,4 16,8" fill="#767061" />
        <polygon points="-18,4 -12,-2 -6,2 -12,8" fill="#9a927f" />
      </g>
      {/* embers + smoke */}
      <polygon points={`-2,${H2 - 4} 3,${H2 - 16} 8,${H2 - 4}`} fill="#e07b30" className="flicker" />
      <polygon points={`0,${H2 - 4} 3,${H2 - 11} 6,${H2 - 4}`} fill="#f2b23c" className="flicker" />
      <circle cx="4" cy={H2 - 26} r="6" fill="#9a958c" opacity="0.5" className="smoke s1" />
      <circle cx="8" cy={H2 - 40} r="8" fill="#9a958c" opacity="0.35" className="smoke s2" />
      <circle cx="14" cy={H2 - 54} r="10" fill="#9a958c" opacity="0.2" className="smoke s3" />
    </g>
  )
}

/** Shared gradient defs: render once inside the board svg. */
export function SpriteDefs() {
  return (
    <defs>
      <linearGradient id="towerGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#aca491" />
        <stop offset="0.55" stopColor="#948c7a" />
        <stop offset="1" stopColor="#736c5d" />
      </linearGradient>
    </defs>
  )
}

// ---------- flat ui icons (header / prices) ----------

export function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="icon">
      <circle cx="10" cy="10" r="9" fill="#d9a834" stroke="#8a6a1c" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="6" fill="none" stroke="#8a6a1c" strokeWidth="1" opacity="0.7" />
      <text x="10" y="14" textAnchor="middle" fontSize="9" fontWeight="700" fill="#6e5416">₪</text>
    </svg>
  )
}

export function BrickIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="icon">
      <rect x="1" y="11" width="9" height="6" rx="1" fill="#b3573f" stroke="#7c3a29" />
      <rect x="11" y="11" width="8" height="6" rx="1" fill="#a34e38" stroke="#7c3a29" />
      <rect x="6" y="4" width="9" height="6" rx="1" fill="#c26247" stroke="#7c3a29" />
    </svg>
  )
}

export function FlameIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="icon">
      <path d="M10 1 C 11 6 15 7 15 12 A 5 5 0 0 1 5 12 C 5 9 7 8 7 5 C 8.5 6.5 9.5 4 10 1 Z" fill="#e0762e" />
      <path d="M10 8 C 10.5 10.5 12.5 11 12.5 13.5 A 2.6 2.6 0 0 1 7.4 13.5 C 7.4 11.5 9.5 11 10 8 Z" fill="#f2b23c" />
    </svg>
  )
}

export function ShieldIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="icon">
      <path d="M10 1 L 18 4 C 18 11 15 16 10 19 C 5 16 2 11 2 4 Z" fill="#5b8def" stroke="#33549c" strokeWidth="1.2" />
      <path d="M10 1 L 18 4 C 18 11 15 16 10 19 Z" fill="#4a73c4" />
    </svg>
  )
}
