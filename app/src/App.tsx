import { useEffect, useReducer, useRef, useState } from 'react'
import type { Sentence, Word } from './lib/types'
import { gameReducer, initialGameState, todayLog, type GameState } from './lib/game'
import { loadState, saveState } from './lib/storage'
import { todayISO, computeStreak } from './lib/time'
import wordsJson from './data/words.json'
import sentencesJson from './data/sentences.json'
import CastleScreen from './ui/CastleScreen'
import SessionScreen from './ui/SessionScreen'
import GuardianScreen from './ui/GuardianScreen'
import StatsScreen from './ui/StatsScreen'
import SettingsScreen from './ui/SettingsScreen'

export const WORDS = wordsJson as Word[]
export const SENTENCES = sentencesJson as Sentence[]

export type Screen = 'castle' | 'learn' | 'guardian' | 'stats' | 'settings'

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, initialGameState)
  const [loaded, setLoaded] = useState(false)
  const [screen, setScreen] = useState<Screen>('castle')
  const [training, setTraining] = useState(false)
  const [sessionNonce, setSessionNonce] = useState(0)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    loadState()
      .then((saved) => {
        if (saved) dispatch({ type: 'import', state: saved })
        dispatch({ type: 'raidCheck', today: todayISO() })
        setLoaded(true)
      })
      .catch((e) => {
        console.error('load failed', e)
        setLoaded(true)
      })
  }, [])

  useEffect(() => {
    if (!loaded) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveState(state).catch((e) => console.error('save failed', e))
    }, 400)
  }, [state, loaded])

  if (!loaded) return <div className="panel">Loading…</div>

  const today = todayISO()
  const log = todayLog(state, today)
  const goalSec = state.settings.dailyGoalMinutes * 60
  const goalPct = Math.min(100, Math.round((log.activeSeconds / goalSec) * 100))
  const streak = computeStreak(state.dayLogs, today)

  const startLearning = () => {
    setTraining(false)
    setSessionNonce((n) => n + 1)
    setScreen('learn')
  }
  const startTraining = () => {
    setTraining(true)
    setSessionNonce((n) => n + 1)
    setScreen('learn')
  }
  const endSession = () => setScreen(training ? 'guardian' : 'castle')

  return (
    <>
      <div className="header">
        <span className="title">🏰 Word Castle</span>
        <span className="stat">🪙 {state.wallet.coins}</span>
        <span className="stat">🧱 {state.wallet.bricks}</span>
        <span className="stat">🔥 {streak}</span>
        <div className="goalbar" title={`${Math.floor(log.activeSeconds / 60)} / ${state.settings.dailyGoalMinutes} min`}>
          <div className={goalPct >= 100 ? 'done' : ''} style={{ width: `${goalPct}%` }} />
        </div>
        <span className="goal-label">
          Daily goal: {Math.floor(log.activeSeconds / 60)} / {state.settings.dailyGoalMinutes} min
          {goalPct >= 100 ? ' ✓ (extra time keeps paying)' : ''}
        </span>
      </div>

      {screen === 'castle' && (
        <CastleScreen state={state} dispatch={dispatch} today={today} onStartSession={startLearning} />
      )}
      {screen === 'learn' && (
        <SessionScreen
          key={`${training}-${sessionNonce}`}
          state={state}
          dispatch={dispatch}
          words={WORDS}
          sentences={SENTENCES}
          training={training}
          onExit={endSession}
        />
      )}
      {screen === 'guardian' && (
        <GuardianScreen state={state} dispatch={dispatch} words={WORDS} onTrain={startTraining} />
      )}
      {screen === 'stats' && <StatsScreen state={state} words={WORDS} today={today} />}
      {screen === 'settings' && <SettingsScreen state={state} dispatch={dispatch} />}

      {screen !== 'learn' && (
        <nav className="nav">
          {(
            [
              ['castle', '🏰', 'Castle'],
              ['guardian', '🛡️', 'Guardian'],
              ['stats', '📊', 'Stats'],
              ['settings', '⚙️', 'Settings'],
            ] as Array<[Screen, string, string]>
          ).map(([s, ico, label]) => (
            <button key={s} className={screen === s ? 'active' : ''} onClick={() => setScreen(s)}>
              <span className="ico">{ico}</span>
              {label}
            </button>
          ))}
        </nav>
      )}
    </>
  )
}

export type { GameState }
