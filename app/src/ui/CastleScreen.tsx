import { useState } from 'react'
import type { Dispatch } from 'react'
import type { GameState, GameAction } from '../lib/game'
import type { CastleItemType } from '../lib/types'
import { SHOP, canBuild, canAfford, rebuildCost } from '../lib/economy'
import { castleDefense } from '../lib/attack'

const GRID = 8

// deterministic wilderness decoration for unclaimed cells
const NATURE = ['🌲', '🌳', '🌿', '🌾', '🪨', '🌼', '', '', '', '']
function natureFor(x: number, y: number): string {
  return NATURE[(x * 7 + y * 13 + ((x * y) % 5)) % NATURE.length]
}

export default function CastleScreen(props: {
  state: GameState
  dispatch: Dispatch<GameAction>
  today: string
  onStartSession: () => void
}) {
  const { state, dispatch, today, onStartSession } = props
  const [placing, setPlacing] = useState<CastleItemType | null>(null)

  const todayAttacks = state.attacks.filter((a) => a.date === today)
  const defense = castleDefense(state.castle) + (state.guardian?.level ?? 0)

  const cellContent = (x: number, y: number) => {
    const building = state.castle.find((i) => i.x === x && i.y === y && i.type !== 'land')
    const land = state.castle.find((i) => i.x === x && i.y === y && i.type === 'land')
    return { building, land }
  }

  const clickCell = (x: number, y: number) => {
    const { building } = cellContent(x, y)
    if (building?.status === 'ruin') {
      const cost = rebuildCost(building.type)
      if (window.confirm(`Rebuild ${SHOP[building.type].label} for 🪙${cost.coins}?`)) {
        dispatch({ type: 'rebuild', itemId: building.id })
      }
      return
    }
    if (!placing) return
    const check = canBuild(placing, state.wallet, state.castle, x, y)
    if (!check.ok) {
      window.alert(check.reason)
      return
    }
    dispatch({ type: 'build', itemType: placing, x, y, nowIso: new Date().toISOString() })
    setPlacing(null)
  }

  return (
    <>
      {todayAttacks.map((a) => (
        <div key={a.id} className={`notice ${a.result === 'win' || a.result === 'defended' ? 'good' : 'bad'}`}>
          {a.kind === 'raid' ? '🌙 Overnight raid' : '⚔️ Attack'} ({a.date}):{' '}
          {a.result === 'win' && `your guardian won! Loot +🪙${a.coinsDelta}`}
          {a.result === 'defended' && 'fully defended, no losses.'}
          {a.result === 'coin-loss' && `raiders took 🪙${-a.coinsDelta}.`}
          {a.result === 'ruin' && `they tore down your latest upgrade${a.coinsDelta ? ` and took 🪙${-a.coinsDelta}` : ''}! Tap the ruin to rebuild.`}
        </div>
      ))}

      <div className="castle-layout">
        <div>
          <div className="panel center">
            <button className="primary" onClick={onStartSession}>
              ▶ Start session
            </button>
            <div className="muted" style={{ marginTop: 8 }}>
              Defense: 🛡️ {defense} {state.guardian ? `(guardian L${state.guardian.level})` : '(no guardian yet)'}
            </div>
          </div>

          <div className="panel">
            <h2>Your castle</h2>
            <div className="grid">
              {Array.from({ length: GRID * GRID }, (_, i) => {
                const x = i % GRID
                const y = Math.floor(i / GRID)
                const { building, land } = cellContent(x, y)
                const placeable = placing ? canBuild(placing, state.wallet, state.castle, x, y).ok : false
                return (
                  <div
                    key={i}
                    className={`cell ${land ? 'land' : 'wild'} ${placeable ? 'placeable' : ''}`}
                    onClick={() => clickCell(x, y)}
                  >
                    {building ? (
                      <span className={building.status === 'ruin' ? 'ruin' : ''}>
                        {SHOP[building.type].emoji}
                      </span>
                    ) : land ? null : (
                      <span className="nature">{natureFor(x, y)}</span>
                    )}
                    {building?.status === 'ruin' && <span className="flame">🔥</span>}
                  </div>
                )
              })}
            </div>
            {placing && (
              <p className="muted">
                Placing {SHOP[placing].emoji} {SHOP[placing].label} — tap a highlighted cell, or{' '}
                <button className="ghost" onClick={() => setPlacing(null)}>cancel</button>
              </p>
            )}
          </div>
        </div>

        <div className="panel">
          <h2>Shop</h2>
          {(Object.keys(SHOP) as CastleItemType[]).map((type) => {
            const e = SHOP[type]
            const affordable = canAfford(type, state.wallet)
            return (
              <div key={type} className={`shop-row ${placing === type ? 'selected' : ''}`}>
                <span>{e.emoji}</span>
                <span className="label">
                  {type === 'land' ? 'Buy plot' : e.label}
                  {e.defense > 0 && <span className="muted"> · +{e.defense} defense</span>}
                </span>
                <span className="price">
                  🪙{e.coins}
                  {e.bricks > 0 && <> 🧱{e.bricks}</>}
                </span>
                <button className="ghost" disabled={!affordable} onClick={() => setPlacing(placing === type ? null : type)}>
                  {placing === type ? 'Cancel' : 'Place'}
                </button>
              </div>
            )
          })}
          <p className="muted">
            Buy a plot to clear the wilderness, then build on it. Bricks come from graduated words:
            learn a word in both directions and it becomes building material.
          </p>
        </div>
      </div>
    </>
  )
}
