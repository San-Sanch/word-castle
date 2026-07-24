import { useMemo, useRef } from 'react'
import type { Dispatch } from 'react'
import type { GameState, GameAction } from '../lib/game'
import type { Word } from '../lib/types'
import { NEUTRAL_BIAS } from '../lib/srs'
import { serializeState, deserializeState } from '../lib/storage'
import { canSpeakHebrew } from '../lib/speech'

export default function SettingsScreen(props: {
  state: GameState
  dispatch: Dispatch<GameAction>
  words: Word[]
  loggedIn: boolean
  onLogin: () => void
  onLogout: () => void
}) {
  const { state, dispatch, words, loggedIn, onLogin, onLogout } = props
  const s = state.settings
  const fileRef = useRef<HTMLInputElement>(null)

  const categories = useMemo(() => {
    const seen: string[] = []
    for (const w of words) if (!seen.includes(w.category)) seen.push(w.category)
    return seen
  }, [words])

  const setBias = (category: string, value: number) =>
    dispatch({
      type: 'setSettings',
      settings: { ...s, categoryBias: { ...s.categoryBias, [category]: value } },
    })

  const setNum = (key: 'newWordsPerDay' | 'dailyGoalMinutes' | 'sessionSize') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Math.max(0, Number(e.target.value) || 0)
      dispatch({ type: 'setSettings', settings: { ...s, [key]: v } })
    }

  const setOptionCount = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.min(12, Math.max(3, Number(e.target.value) || 8))
    dispatch({ type: 'setSettings', settings: { ...s, optionCount: v } })
  }

  const toggle = (key: keyof typeof s.exercises) => () =>
    dispatch({
      type: 'setSettings',
      settings: { ...s, exercises: { ...s.exercises, [key]: !s.exercises[key] } },
    })

  const exportSave = () => {
    const blob = new Blob([serializeState(state)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `word-castle-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importSave = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then((text) => {
      try {
        const restored = deserializeState(text)
        if (window.confirm('Replace current progress with this backup?')) {
          dispatch({ type: 'import', state: restored })
        }
      } catch (err) {
        window.alert(`Could not read backup: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  return (
    <>
      <div className="panel">
        <h2>👤 Account</h2>
        {loggedIn ? (
          <>
            <p className="muted">☁️ Signed in — your progress syncs to your Wix account across devices.</p>
            <button className="ghost" onClick={onLogout}>🚪 Log out</button>
          </>
        ) : (
          <>
            <p className="muted">You're playing locally on this device. Sign in to sync your progress across devices.</p>
            <button className="ghost" onClick={onLogin}>☁️ Sign in to sync</button>
          </>
        )}
      </div>

      <div className="panel">
        <h2>⚙️ Learning</h2>
        <div className="field">
          <label>New words per day</label>
          <input type="number" value={s.newWordsPerDay} onChange={setNum('newWordsPerDay')} />
        </div>
        <div className="field">
          <label>Daily goal (minutes of active practice)</label>
          <input type="number" value={s.dailyGoalMinutes} onChange={setNum('dailyGoalMinutes')} />
        </div>
        <div className="field">
          <label>Cards per session</label>
          <input type="number" value={s.sessionSize} onChange={setNum('sessionSize')} />
        </div>
        <div className="field">
          <label>Answer options per question (3–12)</label>
          <input type="number" min={3} max={12} value={s.optionCount} onChange={setOptionCount} />
        </div>
      </div>

      <div className="panel">
        <h2>📚 Topics: new vs repeat</h2>
        <p className="muted">
          Per topic, how eagerly new words are introduced: far left = lots of new words first,
          far right = no new words, only repeat what you already started.
        </p>
        <div className="bias-header">
          <span>More new words</span>
          <span>More repetition</span>
        </div>
        {categories.map((cat) => {
          const val = s.categoryBias[cat] ?? NEUTRAL_BIAS
          return (
            <div className="field bias-row" key={cat}>
              <label>{cat}</label>
              <div className="bias-dots" role="radiogroup" aria-label={`${cat}: new vs repeated words`}>
                {[0, 1, 2, 3, 4].map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={val === v}
                    className={`bias-dot ${val === v ? 'on' : ''}`}
                    title={['Max new', 'More new', 'Neutral', 'Fewer new', 'No new words'][v]}
                    onClick={() => setBias(cat, v)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="panel">
        <h2>Exercises</h2>
        {(
          [
            ['choice', 'Multiple choice'],
            ['blank', 'Fill the blank'],
            ['match', 'Match pairs (bonus round)'],
            ['sound', 'Sound match (bonus round, hear the word)'],
          ] as Array<[keyof typeof s.exercises, string]>
        ).map(([key, label]) => (
          <div className="field" key={key}>
            <label>{label}</label>
            <input type="checkbox" checked={s.exercises[key]} onChange={toggle(key)} />
          </div>
        ))}
        {!canSpeakHebrew() && (
          <p className="muted">
            ⚠️ No voice found for this course's language in your browser, so pronunciation and the
            sound round are unavailable.
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Backup</h2>
        <div className="row-gap">
          <button className="ghost" onClick={exportSave}>⬇️ Export progress (JSON)</button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>⬆️ Import backup</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={importSave} />
        </div>
        <p className="muted">Export a backup any time; import replaces your current course progress.</p>
      </div>

      <div className="panel">
        <h2>Danger zone</h2>
        <button
          className="ghost"
          style={{ color: 'var(--red)' }}
          onClick={() => {
            if (window.confirm('Wipe ALL progress? This cannot be undone.') && window.confirm('Really sure?')) {
              dispatch({ type: 'reset' })
            }
          }}
        >
          🗑 Reset everything
        </button>
      </div>
    </>
  )
}
