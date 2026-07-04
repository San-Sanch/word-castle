import { useEffect, useReducer, useRef, useState } from 'react'
import type { Sentence, Word } from './lib/types'
import { gameReducer, newPlayerState, todayLog, type GameState } from './lib/game'
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
import { initSpeech, loadVocalized, type VocalizedMap } from './lib/speech'
import wordsJson from './data/words.json'
import sentencesJson from './data/sentences.json'
import vocalizedJson from './data/vocalized.json'

loadVocalized(vocalizedJson as VocalizedMap)
import LearnScreen from './ui/LearnScreen'
import SessionScreen, { type SessionMode } from './ui/SessionScreen'
import SpeedScreen from './ui/SpeedScreen'
import StatsScreen from './ui/StatsScreen'
import VocabularyScreen from './ui/VocabularyScreen'
import SettingsScreen from './ui/SettingsScreen'

export const WORDS = wordsJson as Word[]
export const SENTENCES = sentencesJson as Sentence[]

export type Screen = 'learn' | 'session' | 'speed' | 'vocabulary' | 'stats' | 'settings'

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, newPlayerState)
  const [profiles, setProfiles] = useState<ProfileMeta[]>(() => listProfiles())
  const [profile, setProfile] = useState<string>(() => activeProfileId())
  const [loaded, setLoaded] = useState(false)
  const [screen, setScreen] = useState<Screen>('learn')
  const [topic, setTopic] = useState<string | null>(null)
  const [sessionMode, setSessionMode] = useState<SessionMode>('normal')
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
        dispatch({ type: 'import', state: saved ?? newPlayerState() })
        setLoaded(true)
      })
      .catch((e) => {
        console.error('load failed', e)
        dispatch({ type: 'import', state: newPlayerState() })
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
    setScreen('learn')
    setProfile(id)
  }

  const handleCreateProfile = async (name: string, test: boolean) => {
    const meta = createProfile(name, test)
    setProfiles(listProfiles())
    switchProfile(meta.id)
  }

  const handleDeleteProfile = async (id: string) => {
    await deleteProfile(id)
    setProfiles(listProfiles())
    if (id === profile) {
      setScreen('learn')
      setProfile(activeProfileId())
    }
  }

  if (!loaded) return <div className="panel">Loading…</div>

  const today = todayISO()
  const log = todayLog(state, today)
  const goalSec = state.settings.dailyGoalMinutes * 60
  const goalPct = Math.min(100, Math.round((log.activeSeconds / goalSec) * 100))
  const streak = computeStreak(state.dayLogs, today)

  const startSession = (t: string | null, mode: SessionMode = 'normal') => {
    setTopic(t)
    setSessionMode(mode)
    setSessionNonce((n) => n + 1)
    setScreen('session')
  }

  return (
    <>
      <div className="header">
        <span className="title">🇮🇱 Word Castle</span>
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
        <span className="stat" title="Words mastered">🎓 {state.graduatedIds.length}</span>
        <span className="stat" title="Day streak">🔥 {streak}</span>
        <div className="goalbar" title={`${Math.floor(log.activeSeconds / 60)} / ${state.settings.dailyGoalMinutes} min`}>
          <div className={goalPct >= 100 ? 'done' : ''} style={{ width: `${goalPct}%` }} />
        </div>
        <span className="goal-label">
          Daily goal: {Math.floor(log.activeSeconds / 60)} / {state.settings.dailyGoalMinutes} min
          {goalPct >= 100 ? ' ✓' : ''}
        </span>
      </div>

      {screen === 'learn' && (
        <LearnScreen
          state={state}
          words={WORDS}
          today={today}
          onStartSession={startSession}
          onSpeedRound={() => setScreen('speed')}
          onSetStudyMode={(m) => dispatch({ type: 'setSettings', settings: { ...state.settings, studyMode: m } })}
        />
      )}
      {screen === 'session' && (
        <SessionScreen
          key={`${profile}-${topic ?? 'all'}-${sessionMode}-${sessionNonce}`}
          state={state}
          dispatch={dispatch}
          words={WORDS}
          sentences={SENTENCES}
          topic={topic}
          mode={sessionMode}
          onExit={() => setScreen('learn')}
          onMoreNew={() => startSession(topic, 'more-new')}
          onPractice={() => startSession(topic, 'practice')}
        />
      )}
      {screen === 'speed' && <SpeedScreen state={state} words={WORDS} onExit={() => setScreen('learn')} />}
      {screen === 'vocabulary' && <VocabularyScreen state={state} words={WORDS} />}
      {screen === 'stats' && <StatsScreen state={state} words={WORDS} today={today} />}
      {screen === 'settings' && (
        <SettingsScreen
          state={state}
          dispatch={dispatch}
          profiles={profiles}
          activeProfile={profile}
          activeProfileMeta={profiles.find((p) => p.id === profile)}
          onSwitchProfile={switchProfile}
          onCreateProfile={handleCreateProfile}
          onDeleteProfile={handleDeleteProfile}
        />
      )}

      {screen !== 'session' && screen !== 'speed' && (
        <nav className="nav">
          {(
            [
              ['learn', '📚', 'Learn'],
              ['vocabulary', '📖', 'Vocabulary'],
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
