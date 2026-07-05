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
import { initSpeech, loadVocalized, loadStressOverrides, setSpeechLang, type VocalizedMap } from './lib/speech'
import wordsJson from './data/words.json'
import sentencesJson from './data/sentences.json'
import vocalizedJson from './data/vocalized.json'
import stressJson from './data/stress-overrides.json'
import enUkWords from './data/course-en-uk.json'
import esEnWords from './data/course-es-en.json'

loadVocalized(vocalizedJson as VocalizedMap)
loadStressOverrides(stressJson as Record<string, string>)
import LearnScreen from './ui/LearnScreen'
import SessionScreen, { type SessionMode } from './ui/SessionScreen'
import SpeedScreen from './ui/SpeedScreen'
import StatsScreen from './ui/StatsScreen'
import VocabularyScreen from './ui/VocabularyScreen'
import SettingsScreen from './ui/SettingsScreen'

export const WORDS = wordsJson as Word[]
export const SENTENCES = sentencesJson as Sentence[]

// A course is a self-contained word set with its own display flag, spoken
// language and progress. Hebrew keeps its rich data (nikud/sentences/translit);
// the Duolingo-derived courses are flat word→translation lists.
export interface Course {
  id: string
  label: string
  flag: string
  words: Word[]
  sentences: Sentence[]
  speechLang: string
  /** the term text is right-to-left (Hebrew) */
  rtl: boolean
  /** reading-comprehension stories exist for this course (Hebrew-only for now) */
  stories: boolean
}

export const COURSES: Course[] = [
  { id: 'hebrew', label: 'Hebrew → Українська', flag: '🇮🇱', words: WORDS, sentences: SENTENCES, speechLang: 'he-IL', rtl: true, stories: true },
  { id: 'en-uk', label: 'English → Українська', flag: '🇬🇧', words: enUkWords as Word[], sentences: [], speechLang: 'en-US', rtl: false, stories: false },
  { id: 'es-en', label: 'Español → English', flag: '🇪🇸', words: esEnWords as Word[], sentences: [], speechLang: 'es-ES', rtl: false, stories: false },
]

const COURSE_KEY = 'wc-active-course'
function activeCourseId(): string {
  const id = localStorage.getItem(COURSE_KEY)
  return COURSES.some((c) => c.id === id) ? (id as string) : COURSES[0].id
}
// Progress is namespaced per (profile, course); Hebrew keeps the bare profile key
// so pre-existing saves migrate untouched.
function storeKey(profileId: string, courseId: string): string {
  return courseId === 'hebrew' ? profileId : `${profileId}__${courseId}`
}

export type Screen = 'learn' | 'session' | 'speed' | 'vocabulary' | 'stats' | 'settings'

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, newPlayerState)
  const [profiles, setProfiles] = useState<ProfileMeta[]>(() => listProfiles())
  const [profile, setProfile] = useState<string>(() => activeProfileId())
  const [courseId, setCourseId] = useState<string>(() => activeCourseId())
  const [loaded, setLoaded] = useState(false)
  const [screen, setScreen] = useState<Screen>('learn')
  const [topic, setTopic] = useState<string | null>(null)
  const [sessionMode, setSessionMode] = useState<SessionMode>('normal')
  const [sessionNonce, setSessionNonce] = useState(0)
  const saveTimer = useRef<number | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const course = COURSES.find((c) => c.id === courseId) ?? COURSES[0]
  const words = course.words
  const sentences = course.sentences
  const storeId = storeKey(profile, course.id)
  const storeIdRef = useRef(storeId)
  storeIdRef.current = storeId

  useEffect(() => {
    initSpeech()
  }, [])

  useEffect(() => {
    setSpeechLang(course.speechLang)
  }, [course.speechLang])

  useEffect(() => {
    setLoaded(false)
    loadState(storeId)
      .then((saved) => {
        dispatch({ type: 'import', state: saved ?? newPlayerState() })
        setLoaded(true)
      })
      .catch((e) => {
        console.error('load failed', e)
        dispatch({ type: 'import', state: newPlayerState() })
        setLoaded(true)
      })
  }, [storeId])

  useEffect(() => {
    if (!loaded) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveState(storeIdRef.current, stateRef.current).catch((e) => console.error('save failed', e))
    }, 400)
  }, [state, loaded])

  // persist current progress before switching the (profile, course) key
  const flushSave = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    if (loaded) saveState(storeIdRef.current, stateRef.current).catch((e) => console.error('save failed', e))
  }

  const switchProfile = (id: string) => {
    if (id === profile) return
    flushSave()
    setActiveProfile(id)
    setScreen('learn')
    setTopic(null)
    setProfile(id)
  }

  const switchCourse = (id: string) => {
    if (id === courseId) return
    flushSave()
    localStorage.setItem(COURSE_KEY, id)
    setScreen('learn')
    setTopic(null)
    setCourseId(id)
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
        <span className="title">{course.flag} Word Castle</span>
        <select
          className="profile-select"
          value={courseId}
          onChange={(e) => switchCourse(e.target.value)}
          title="Course / language"
        >
          {COURSES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.flag} {c.label}
            </option>
          ))}
        </select>
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
          words={words}
          caps={{ sentences: sentences.length > 0, stories: course.stories }}
          today={today}
          onStartSession={startSession}
          onSpeedRound={() => setScreen('speed')}
          onSetStudyMode={(m) => dispatch({ type: 'setSettings', settings: { ...state.settings, studyMode: m } })}
          onToggleReverse={() => dispatch({ type: 'setSettings', settings: { ...state.settings, reverse: !state.settings.reverse } })}
        />
      )}
      {screen === 'session' && (
        <SessionScreen
          key={`${storeId}-${topic ?? 'all'}-${sessionMode}-${sessionNonce}`}
          state={state}
          dispatch={dispatch}
          words={words}
          sentences={sentences}
          rtl={course.rtl}
          caps={{ sentences: sentences.length > 0, stories: course.stories }}
          topic={topic}
          mode={sessionMode}
          onExit={() => setScreen('learn')}
          onMoreNew={() => startSession(topic, 'more-new')}
          onPractice={() => startSession(topic, 'practice')}
        />
      )}
      {screen === 'speed' && <SpeedScreen state={state} words={words} onExit={() => setScreen('learn')} />}
      {screen === 'vocabulary' && <VocabularyScreen state={state} words={words} />}
      {screen === 'stats' && <StatsScreen state={state} words={words} today={today} />}
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
