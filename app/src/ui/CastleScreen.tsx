import { useState } from 'react'
import type { Dispatch } from 'react'
import type { GameState, GameAction } from '../lib/game'
import type { CastleItemType } from '../lib/types'
import { SHOP, BUILD_MENU, canBuildAt, canAfford, rebuildCost, type ShopCost } from '../lib/economy'
import { castleDefense } from '../lib/attack'
import { hasChestAt, siegingCamp } from '../lib/world'
import { computeProtectedIds } from '../lib/enclosure'
import WorldBoard, { SpriteThumb } from './WorldBoard'
import { CoinIcon, BrickIcon, WoodIcon, StoneIcon, FoodIcon, ShieldIcon } from './sprites'

function Cost({ cost }: { cost: ShopCost }) {
  return (
    <span className="price">
      {cost.coins > 0 && <>{cost.coins} <CoinIcon /></>}
      {cost.bricks > 0 && <> {cost.bricks} <BrickIcon /></>}
      {cost.wood > 0 && <> {cost.wood} <WoodIcon /></>}
      {cost.stone > 0 && <> {cost.stone} <StoneIcon /></>}
      {cost.food > 0 && <> {cost.food} <FoodIcon /></>}
    </span>
  )
}

export default function CastleScreen(props: {
  state: GameState
  dispatch: Dispatch<GameAction>
  today: string
  onStartSession: () => void
}) {
  const { state, dispatch, today, onStartSession } = props
  const [placing, setPlacing] = useState<CastleItemType | null>(null)
  const [demolishing, setDemolishing] = useState(false)
  const [recenter, setRecenter] = useState(0)

  const todayAttacks = state.attacks.filter((a) => a.date === today)
  const defense = castleDefense(state.castle) + (state.guardian?.level ?? 0)
  const sieging = siegingCamp(state.camps, state.castle)
  const protectedCount = computeProtectedIds(state.castle).size

  const clickCell = (x: number, y: number) => {
    const here = state.castle.filter((i) => i.x === x && i.y === y)
    const building = here.find((i) => i.type !== 'land')

    if (demolishing) {
      const target = building ?? here[0]
      if (!target) return
      if (window.confirm(`Tear down the ${SHOP[target.type].label}? Nothing is refunded.`)) {
        dispatch({ type: 'demolish', itemId: target.id })
      }
      return
    }
    if (building?.status === 'ruin') {
      const cost = rebuildCost(building.type)
      if (window.confirm(`Rebuild ${SHOP[building.type].label} for ${cost.coins} coins?`)) {
        dispatch({ type: 'rebuild', itemId: building.id })
      }
      return
    }
    if (!placing && hasChestAt(x, y) && !state.chestsCollected.includes(`${x},${y}`)) {
      dispatch({ type: 'collectChest', x, y })
      return
    }
    if (!placing) return
    const check = canBuildAt(placing, x, y, state.wallet, state.castle)
    if (!check.ok) {
      window.alert(check.reason)
      return
    }
    dispatch({ type: 'build', itemType: placing, x, y, nowIso: new Date().toISOString() })
  }

  return (
    <>
      {sieging && (
        <div className="notice bad">
          ⚔️ An enemy camp is at your doorstep (strength {sieging.strength})! The battle starts with your next session.
        </div>
      )}
      {!sieging && state.camps.length > 0 && (
        <div className="notice bad">
          🥁 War drums in the distance… {state.camps.length === 1 ? 'an enemy camp is' : `${state.camps.length} enemy camps are`} moving toward you.
          Keep practicing to earn defenses, and remember: only a closed wall ring with a gate protects what is inside.
        </div>
      )}
      {todayAttacks.map((a) => (
        <div key={a.id} className={`notice ${a.result === 'win' || a.result === 'defended' ? 'good' : 'bad'}`}>
          {a.kind === 'raid' ? '🌙 Overnight raid' : '⚔️ Battle'} ({a.date}):{' '}
          {a.result === 'win' && <>you won! Loot +{a.coinsDelta} <CoinIcon /></>}
          {a.result === 'defended' && 'fully defended, no losses.'}
          {a.result === 'coin-loss' && <>raiders took {-a.coinsDelta} <CoinIcon />.</>}
          {a.result === 'ruin' && <>they tore something down{a.coinsDelta ? <> and took {-a.coinsDelta} <CoinIcon /></> : ''}! Tap the ruin to rebuild.</>}
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
              {protectedCount > 0 && <> · 🏰 {protectedCount} buildings behind walls</>}
            </div>
          </div>

          <div className="panel board-panel">
            <div className="board-toolbar">
              <h2>Your realm</h2>
              <div className="row-gap">
                <button className="ghost" onClick={() => setRecenter((n) => n + 1)}>🎯 Home</button>
                <button
                  className={`ghost ${demolishing ? 'danger-active' : ''}`}
                  onClick={() => { setDemolishing((d) => !d); setPlacing(null) }}
                >
                  {demolishing ? '✋ Stop demolishing' : '🔨 Demolish'}
                </button>
              </div>
            </div>
            <WorldBoard
              castle={state.castle}
              camps={state.camps}
              chestsCollected={state.chestsCollected}
              placing={!!placing}
              placeableAt={(x, y) => (placing ? canBuildAt(placing, x, y, state.wallet, state.castle).ok : false)}
              onCellClick={clickCell}
              recenterSignal={recenter}
            />
            <p className="muted center" style={{ marginBottom: 0 }}>
              {demolishing
                ? 'Demolish mode: tap a building to tear it down (no refund).'
                : placing
                  ? <>Placing <b>{SHOP[placing].label}</b> — tap a glowing tile, or <button className="ghost" onClick={() => setPlacing(null)}>cancel</button></>
                  : 'Drag to explore. Tap chests to collect them. The fog hides what your buildings cannot see.'}
            </p>
          </div>
        </div>

        <div className="panel">
          <h2>Build</h2>
          {BUILD_MENU.map((type) => {
            const e = SHOP[type]
            const affordable = canAfford(type, state.wallet)
            return (
              <div key={type} className={`shop-row ${placing === type ? 'selected' : ''}`}>
                <SpriteThumb type={type} />
                <span className="label">
                  {e.label}
                  {e.defense > 0 && <span className="muted"> · +{e.defense} def</span>}
                  <div className="muted blurb">{e.blurb}</div>
                </span>
                <Cost cost={e.cost} />
                <button
                  className="ghost"
                  disabled={!affordable}
                  onClick={() => { setDemolishing(false); setPlacing(placing === type ? null : type) }}
                >
                  {placing === type ? 'Cancel' : 'Place'}
                </button>
              </div>
            )
          })}
          <p className="muted">
            Roads grow your reach, fields feed guardians, woodcutters and quarries unlock better
            construction. Walls protect only a fully closed ring with at least one gate.
          </p>
        </div>
      </div>
    </>
  )
}
