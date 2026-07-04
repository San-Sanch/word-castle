import { useState } from 'react'
import type { Dispatch } from 'react'
import type { GameState, GameAction } from '../lib/game'
import type { CastleItemType } from '../lib/types'
import { SHOP, canBuild, canAfford, rebuildCost } from '../lib/economy'
import { castleDefense } from '../lib/attack'
import CastleBoard, { SpriteThumb } from './CastleBoard'
import { CoinIcon, BrickIcon, ShieldIcon } from './sprites'

const GRID = 8

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

  const clickCell = (x: number, y: number) => {
    const building = state.castle.find((i) => i.x === x && i.y === y && i.type !== 'land')
    if (building?.status === 'ruin') {
      const cost = rebuildCost(building.type)
      if (window.confirm(`Rebuild ${SHOP[building.type].label} for ${cost.coins} coins?`)) {
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
          {a.result === 'win' && <>your guardian won! Loot +{a.coinsDelta} <CoinIcon /></>}
          {a.result === 'defended' && 'fully defended, no losses.'}
          {a.result === 'coin-loss' && <>raiders took {-a.coinsDelta} <CoinIcon />.</>}
          {a.result === 'ruin' && <>they tore down your latest upgrade{a.coinsDelta ? <> and took {-a.coinsDelta} <CoinIcon /></> : ''}! Tap the ruin to rebuild.</>}
        </div>
      ))}

      <div className="castle-layout">
        <div>
          <div className="panel center">
            <button className="primary" onClick={onStartSession}>
              ▶ Start session
            </button>
            <div className="muted defense-line">
              Defense: <ShieldIcon /> {defense} {state.guardian ? `(guardian L${state.guardian.level})` : '(no guardian yet)'}
            </div>
          </div>

          <div className="panel board-panel">
            <h2>Your castle</h2>
            <CastleBoard
              grid={GRID}
              castle={state.castle}
              placing={!!placing}
              placeableAt={(x, y) => (placing ? canBuild(placing, state.wallet, state.castle, x, y).ok : false)}
              onCellClick={clickCell}
            />
            {placing && (
              <p className="muted center">
                Placing <b>{placing === 'land' ? 'plot' : SHOP[placing].label}</b> — tap a glowing cell, or{' '}
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
                <SpriteThumb type={type} />
                <span className="label">
                  {type === 'land' ? 'Buy plot' : e.label}
                  {e.defense > 0 && <span className="muted"> · +{e.defense} defense</span>}
                </span>
                <span className="price">
                  {e.coins} <CoinIcon />
                  {e.bricks > 0 && <> {e.bricks} <BrickIcon /></>}
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
