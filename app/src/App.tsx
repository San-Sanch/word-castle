import { useEffect, useReducer, useRef, useState } from 'react'
import type { Sentence, Word } from './lib/types'
import { gameReducer, initialGameState, todayLog, type GameState } from './lib/game'
import {
  activeProfileId,
  createProfile,
  deleteProfile,
  listProfiles,
  loadState,
  saveState,
  setActiveProfile,
  type ProfileMeta,
} from './lib/storage'
import { todayISO, computeStreak } from './lib/time'
import { initSpeech } from './lib/speech'
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

const TEST_PROFILE_WALLET = { coins: 100000, bricks: 1000 }

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, initialGameState)
  const [profiles, setProfiles] = useState<ProfileMeta[]>(() => listProfiles())
  const [profile, setProfile] = useState<string>(() => activeProfileId())
  const [loaded, setLoaded] = useState(false)
  const [screen, setScreen] = useState<Screen>('castle')
  const [training, setTraining] = useState(false)
  const [sessionNonce, setSessionNonce] = useState(0)
  const saveTimer = useRef<number | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    initSpeech()
  }, [])

  useEffect(() => {
    setLoaded(false)
    loadState(profile)
      .then((saved) => {
        dispatch({ type: 'import', state: saved ?? initialGameState() })
        dispatch({ type: 'raidCheck', today: todayISO() })
        setLoaded(true)
      })
      .catch((e) => {
        console.error('load failed', e)
        dispatch({ type: 'import', state: initialGameState() })
        setLoaded(true)
      })
  }, [profile])

  useEffect(() => {
    if (!loaded) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveState(profile, stateRef.current).catch((e) => console.error('save failed', e))
    }, 400)
  }, [state, loaded, profile])

  const switchProfile = (id: string) => {
    if (id === profile) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    if (loaded) saveState(profile, stateRef.current).catch((e) => console.error('save failed', e))
    setActiveProfile(id)
    setScreen('castle')
    setTraining(false)
    setProfile(id)
  }

  const handleCreateProfile = async (name: string, test: boolean) => {
    const meta = createProfile(name, test)
    if (test) {
      await saveState(meta.id, { ...initialGameState(), wallet: { ...TEST_PROFILE_WALLET } })
    }
    setProfiles(listProfiles())
    switchProfile(meta.id)
  }

  const handleDeleteProfile = async (id: string) => {
    await deleteProfile(id)
    const remaining = listProfiles()
    setProfiles(remaining)
    if (id === profile) {
      setScreen('castle')
      setProfile(activeProfileId())
    }
  }

  if (!loaded) return <div className="panel">Loading…</div>

  const today = todayISO()
  const log = todayLog(state, today)
  const goalSec = state.settings.dailyGoalMinutes * 60
  const goalPct = Math.min(100, Math.round((log.activeSeconds / goalSec) * 100))
  const streak = computeStreak(state.dayLogs, today)
  const profileMeta = profiles.find((p) => p.id === profile)

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
        <select
          className="profile-select"
          value={profile}
          onChange={(e) => switchProfile(e.target.value)}
          title="Player profile"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.test ? '🧪 ' : '👤 '}
              {p.name}
            </option>
          ))}
        </select>
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
          key={`${profile}-${training}-${sessionNonce}`}
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
      {screen === 'settings' && (
        <SettingsScreen
          state={state}
          dispatch={dispatch}
          profiles={profiles}
          activeProfile={profile}
          activeProfileMeta={profileMeta}
          onSwitchProfile={switchProfile}
          onCreateProfile={handleCreateProfile}
          onDeleteProfile={handleDeleteProfile}
        />
      )}

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
