import { useState } from 'react'
import type { Dispatch } from 'react'
import type { GameState, GameAction } from '../lib/game'
import type { Word } from '../lib/types'
import { HIRE_COST, setsToNextLevel, MAX_LEVEL } from '../lib/guardian'

const AVATARS = ['🦁', '🐺', '🦅', '🐉', '🦉']

export default function GuardianScreen(props: {
  state: GameState
  dispatch: Dispatch<GameAction>
  words: Word[]
  onTrain: () => void
}) {
  const { state, dispatch, words, onTrain } = props
  const categories = [...new Set(words.map((w) => w.category))].sort()
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(AVATARS[0])
  const [category, setCategory] = useState(categories[0] ?? '')

  if (!state.guardian) {
    const affordable = state.wallet.coins >= HIRE_COST
    return (
      <div className="panel">
        <h2>🛡️ Hire a guardian</h2>
        <p className="muted">
          A guardian defends your castle from attacks and overnight raids. Train them with extra
          lesson sets from their favorite category to level them up (max L{MAX_LEVEL}).
        </p>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Golem" />
        </div>
        <div className="field">
          <label>Avatar</label>
          <div className="row-gap">
            {AVATARS.map((a) => (
              <button key={a} className="ghost" style={avatar === a ? { outline: '2px solid var(--gold)' } : {}} onClick={() => setAvatar(a)}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Specialty category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <button
          className="primary"
          disabled={!affordable || !name.trim()}
          onClick={() =>
            dispatch({ type: 'hire', name: name.trim(), avatar, category, nowIso: new Date().toISOString() })
          }
        >
          Hire for 🪙{HIRE_COST}
        </button>
        {!affordable && <p className="muted">Earn {HIRE_COST - state.wallet.coins} more coins first.</p>}
      </div>
    )
  }

  const g = state.guardian
  const toNext = setsToNextLevel(g.setsCompleted)
  return (
    <div className="panel center">
      <div style={{ fontSize: 70 }}>{g.avatar}</div>
      <h2>
        {g.name} · Level {g.level}
      </h2>
      <p className="muted">
        Specialty: {g.category} · {g.setsCompleted} training sets completed
      </p>
      {g.level < MAX_LEVEL ? (
        <p>
          {toNext} more training {toNext === 1 ? 'set' : 'sets'} to reach level {g.level + 1}.
        </p>
      ) : (
        <p>Fully trained! Your castle sleeps safe.</p>
      )}
      <p className="muted">
        A training set is ~20 extra cards from {g.category}. It counts toward your daily time and coins too.
      </p>
      <button className="primary" onClick={onTrain}>
        🏋️ Train ({g.category})
      </button>
    </div>
  )
}
