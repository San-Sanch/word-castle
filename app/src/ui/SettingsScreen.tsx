import { useRef } from 'react'
import type { Dispatch } from 'react'
import type { GameState, GameAction } from '../lib/game'
import { serializeState, deserializeState } from '../lib/storage'

export default function SettingsScreen(props: { state: GameState; dispatch: Dispatch<GameAction> }) {
  const { state, dispatch } = props
  const s = state.settings
  const fileRef = useRef<HTMLInputElement>(null)

  const setNum = (key: 'newWordsPerDay' | 'dailyGoalMinutes' | 'sessionSize' | 'attackChancePct') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Math.max(0, Number(e.target.value) || 0)
      dispatch({ type: 'setSettings', settings: { ...s, [key]: v } })
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
          <label>Attack chance per session (%)</label>
          <input type="number" value={s.attackChancePct} onChange={setNum('attackChancePct')} />
        </div>
      </div>

      <div className="panel">
        <h2>Exercises</h2>
        {(
          [
            ['choice', 'Multiple choice'],
            ['blank', 'Fill the blank'],
            ['match', 'Match pairs (bonus round)'],
            ['lightning', 'Lightning round (attacks)'],
          ] as Array<[keyof typeof s.exercises, string]>
        ).map(([key, label]) => (
          <div className="field" key={key}>
            <label>{label}</label>
            <input type="checkbox" checked={s.exercises[key]} onChange={toggle(key)} />
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Backup</h2>
        <div className="row-gap">
          <button className="ghost" onClick={exportSave}>⬇️ Export progress (JSON)</button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>⬆️ Import backup</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={importSave} />
        </div>
        <p className="muted">Progress lives in this browser only. Export a backup now and then.</p>
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
