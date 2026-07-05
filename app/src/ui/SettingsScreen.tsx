import { useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { GameState, GameAction } from '../lib/game'
import { serializeState, deserializeState, type ProfileMeta } from '../lib/storage'
import { canSpeakHebrew } from '../lib/speech'

export default function SettingsScreen(props: {
  state: GameState
  dispatch: Dispatch<GameAction>
  profiles: ProfileMeta[]
  activeProfile: string
  activeProfileMeta: ProfileMeta | undefined
  onSwitchProfile: (id: string) => void
  onCreateProfile: (name: string, test: boolean) => void
  onDeleteProfile: (id: string) => void
}) {
  const { state, dispatch, profiles, activeProfile, onSwitchProfile, onCreateProfile, onDeleteProfile } = props
  const s = state.settings
  const fileRef = useRef<HTMLInputElement>(null)
  const [newName, setNewName] = useState('')

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

  const createProfile = (test: boolean) => {
    const name = newName.trim() || (test ? 'Test' : 'Player')
    onCreateProfile(name, test)
    setNewName('')
  }

  return (
    <>
      <div className="panel">
        <h2>👥 Profiles</h2>
        {profiles.map((p) => (
          <div key={p.id} className="shop-row">
            <span>{p.test ? '🧪' : '👤'}</span>
            <span className="label">
              {p.name}
              {p.id === activeProfile && <span className="muted"> · active</span>}
              {p.test && <span className="muted"> · test resources</span>}
            </span>
            {p.id !== activeProfile && (
              <button className="ghost" onClick={() => onSwitchProfile(p.id)}>Switch</button>
            )}
            {profiles.length > 1 && (
              <button
                className="ghost"
                style={{ color: 'var(--red)' }}
                onClick={() => {
                  if (window.confirm(`Delete profile "${p.name}" and all its progress?`)) onDeleteProfile(p.id)
                }}
              >
                🗑
              </button>
            )}
          </div>
        ))}
        <div className="row-gap" style={{ marginTop: 10 }}>
          <input
            placeholder="New profile name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="ghost" onClick={() => createProfile(false)}>➕ New player</button>
          <button className="ghost" onClick={() => createProfile(true)}>🧪 Test profile</button>
        </div>
        <p className="muted">
          Each profile has fully separate learning progress and settings — handy for trying the
          fresh-player experience or letting a teammate play.
        </p>
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
            ⚠️ No Hebrew voice found in this browser, so pronunciation and the sound round are unavailable.
            On macOS: System Settings → Accessibility → Spoken Content → System voice → add a Hebrew voice (e.g. Carmit).
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
