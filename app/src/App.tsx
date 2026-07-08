import { useEffect, useReducer, useRef, useState } from 'react'
import type { Sentence, Word } from './lib/types'
import { gameReducer, newPlayerState, todayLog, type GameState } from './lib/game'
import { loadState as loadLocalState } from './lib/storage'
import { loadCourseState, saveCourseState, migrateLocalToCloud } from './lib/cloudStore'
import { isLoggedIn, startLogin, completeLoginIfCallback, logout, makeCloudBackend } from './lib/wixClient'
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
// Legacy local (pre-cloud) storage key, used only to migrate old progress once.
function legacyStoreKey(courseId: string): string {
  return courseId === 'hebrew' ? 'main' : `main__${courseId}`
}
const MIGRATED_KEY = 'wc-migrated-to-cloud'

const backend = makeCloudBackend()

export type Screen = 'learn' | 'session' | 'speed' | 'vocabulary' | 'stats' | 'settings'
type Auth = 'checking' | 'out' | 'in'

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="panel center hero">
      <h1 className="title" style={{ fontSize: 28 }}>🏰 Word Castle</h1>
      <p className="muted">Sign in to sync your learning progress across devices.</p>
      <button className="primary big" onClick={onLogin}>Sign in / Sign up</button>
    </div>
  )
}

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, newPlayerState)
  const [auth, setAuth] = useState<Auth>('checking')
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
  const courseIdRef = useRef(course.id)
  courseIdRef.current = course.id

  useEffect(() => {
    initSpeech()
  }, [])

  useEffect(() => {
    setSpeechLang(course.speechLang)
  }, [course.speechLang])

  // resolve auth on load: finish any login callback, then (once) migrate legacy
  // local progress into the cloud so the pilot's data isn't lost.
  useEffect(() => {
    ;(async () => {
      try {
        await completeLoginIfCallback()
      } catch (e) {
        console.error('login callback failed', e)
      }
      if (!isLoggedIn()) {
        setAuth('out')
        return
      }
      if (!localStorage.getItem(MIGRATED_KEY)) {
        try {
          for (const c of COURSES) {
            const local = await loadLocalState(legacyStoreKey(c.id))
            if (local) await migrateLocalToCloud(backend, c.id, '', local, new Date().toISOString())
          }
        } catch (e) {
          console.error('cloud migration failed', e)
        }
        localStorage.setItem(MIGRATED_KEY, '1')
      }
      setAuth('in')
    })()
  }, [])

  // load the active course's progress from the cloud
  useEffect(() => {
    if (auth !== 'in') return
    setLoaded(false)
    loadCourseState(backend, course.id)
      .then((saved) => {
        dispatch({ type: 'import', state: saved ?? newPlayerState() })
        setLoaded(true)
      })
      .catch((e) => {
        console.error('cloud load failed', e)
        dispatch({ type: 'import', state: newPlayerState() })
        setLoaded(true)
      })
  }, [auth, courseId])

  useEffect(() => {
    if (auth !== 'in' || !loaded) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveCourseState(backend, courseIdRef.current, '', stateRef.current, new Date().toISOString())
        .catch((e) => console.error('cloud save failed', e))
    }, 600)
  }, [state, loaded, auth])

  const flushSave = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    if (auth === 'in' && loaded) {
      saveCourseState(backend, courseIdRef.current, '', stateRef.current, new Date().toISOString())
        .catch((e) => console.error('cloud save failed', e))
    }
  }

  const switchCourse = (id: string) => {
    if (id === courseId) return
    flushSave()
    localStorage.setItem(COURSE_KEY, id)
    setScreen('learn')
    setTopic(null)
    setCourseId(id)
  }

  if (auth === 'checking') return <div className="panel">Loading…</div>
  if (auth === 'out') return <LoginScreen onLogin={startLogin} />
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
          key={`${course.id}-${topic ?? 'all'}-${sessionMode}-${sessionNonce}`}
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
      {screen === 'settings' && <SettingsScreen state={state} dispatch={dispatch} onLogout={logout} />}

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
