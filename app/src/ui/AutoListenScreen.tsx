import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import { todayLog, LISTEN_RATING_MAX, LISTEN_RATING_MIN, type GameAction, type GameState } from '../lib/game'
import { DEFAULT_SETTINGS, type Sentence, type Word } from '../lib/types'
import {
  buildAutoPlaylist,
  pauseAfterMs,
  clampPauseSec,
  PAUSE_MIN_SEC,
  PAUSE_MAX_SEC,
  type ListenContent,
} from '../lib/autoListen'
import { speakHebrew, speakText, canSpeakHebrew, canSpeakLang, speechBusy, speechSpeaking } from '../lib/speech'
import { translationParts } from '../lib/translations'
import { fetchWordErrors } from '../lib/wixClient'
import { useLongPress } from './useLongPress'
import { useWakeLock, wakeLockSupported } from './useWakeLock'
import { HoldRing } from './HoldRing'

const TIMER_CHOICES = [0, 5, 10, 15, 30] // minutes, 0 = until stopped
const PAUSE_CHOICES = Array.from(
  { length: PAUSE_MAX_SEC - PAUSE_MIN_SEC + 1 },
  (_, i) => PAUSE_MIN_SEC + i,
)
const CONTENT_OPTS: Array<[ListenContent, string]> = [
  ['words', 'Words'],
  ['both', 'Both'],
  ['sentences', 'Sentences'],
]
/** easy-vote (▼) advances to the next word after this much silence */
const EASY_ADVANCE_MS = 500
/** how long audio may take to actually start before the screen calls it broken.
 * Generous: a queued utterance can take a couple of seconds to reach the speaker
 * on a busy phone, and a false alarm is worse than a late one. */
const SPEECH_WATCHDOG_MS = 5000

function haptic() {
  try { (navigator as unknown as { vibrate?: (n: number) => void }).vibrate?.(40) } catch { /* no haptics */ }
}

export default function AutoListenScreen(props: {
  state: GameState
  words: Word[]
  sentences: Sentence[]
  today: string
  dispatch: Dispatch<GameAction>
  /** BCP-47 language the translation side is spoken in (en-US for Hebrew, uk-UA for en-uk) */
  translationLang: string
  /** the term is right-to-left (Hebrew) */
  rtl: boolean
  /** translations are comma-separated meaning lists — speak only the first one */
  splitTranslations: boolean
  /** flag the current word as mispronounced (Hebrew course only) */
  onReportWord?: (word: Word) => void
}) {
  const { state, words, sentences, today, dispatch, translationLang, rtl, splitTranslations, onReportWord } = props
  const wordById = useMemo(() => new Map(words.map((w) => [w.id, w])), [words])
  const categories = useMemo(() => {
    const seen: string[] = []
    for (const w of words) if (!seen.includes(w.category)) seen.push(w.category)
    return seen
  }, [words])
  const hasSentences = sentences.length > 0

  const [content, setContent] = useState<ListenContent>('words')
  const [category, setCategory] = useState<string | null>(null)
  const [shuffled, setShuffled] = useState(true)
  const [shuffleNonce, setShuffleNonce] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  // translation stays hidden until the card is tapped; hides again on the next word
  const [revealed, setRevealed] = useState(false)

  // Crediting exposures changes state.reviews mid-playback, which would reshuffle
  // the list under the running loop (the card on screen would drift out of sync
  // with the audio). So the playlist is built from a snapshot that only refreshes
  // while stopped.
  const [reviewsSnapshot, setReviewsSnapshot] = useState(state.reviews)
  useEffect(() => {
    if (!playing) setReviewsSnapshot(state.reviews)
  }, [playing, state.reviews])

  const ratedOrder = state.settings.listenRatedOrder ?? true
  // difficulty votes reorder the NEXT playlist build (entering the screen,
  // toggling shuffle/filters) — never the one currently on screen
  const ratingsRef = useRef(state.listenRatings)
  ratingsRef.current = state.listenRatings

  // ordered by default (reviews first); a fresh random order only when shuffled
  const playlist = useMemo(
    () => buildAutoPlaylist({
      words, reviews: reviewsSnapshot, sentences, content, category,
      categoryBias: state.settings.categoryBias, shuffle: shuffled,
      ratings: ratingsRef.current, ratedOrder, rng: Math.random,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words, sentences, reviewsSnapshot, content, category, state.settings.categoryBias, shuffled, shuffleNonce, ratedOrder],
  )
  const [reverse, setReverse] = useState(false)
  const [timerMin, setTimerMin] = useState(0)
  const [leftSec, setLeftSec] = useState<number | null>(null)
  // wordIds already reported (from the cloud) plus ones flagged this session
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!onReportWord) return
    fetchWordErrors()
      .then((m) => setFlaggedIds(new Set(Object.keys(m).filter((id) => m[id] === 'error'))))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runRef = useRef(0) // bumping it cancels any in-flight speak/pause chain
  const timeoutRef = useRef<number | null>(null)
  const reverseRef = useRef(reverse)
  reverseRef.current = reverse
  const idxRef = useRef(idx)
  idxRef.current = idx
  const playingRef = useRef(playing)
  playingRef.current = playing
  const playlistRef = useRef(playlist)
  playlistRef.current = playlist
  const todayRef = useRef(today)
  todayRef.current = today
  const transLangRef = useRef(translationLang)
  transLangRef.current = translationLang
  const splitRef = useRef(splitTranslations)
  splitRef.current = splitTranslations

  // pause "a" (term → translation) and "b" (before the next word), in seconds
  const pauseSec = clampPauseSec(state.settings.listenPauseSec, DEFAULT_SETTINGS.listenPauseSec)
  const gapSec = clampPauseSec(state.settings.listenGapSec, DEFAULT_SETTINGS.listenGapSec)
  const pausesRef = useRef({ pauseSec, gapSec })
  pausesRef.current = { pauseSec, gapSec }
  const setPause = (key: 'listenPauseSec' | 'listenGapSec', sec: number) =>
    dispatch({ type: 'setSettings', settings: { ...state.settings, [key]: sec } })

  // option B for background playback: the screen simply doesn't sleep while
  // listening (speechSynthesis is suspended on lock, so real background audio
  // needs pre-rendered clips — see SPEC §16)
  const wake = useWakeLock(playing)

  // WebKit sometimes accepts an utterance and never speaks it (engine left in a
  // bad state by a backgrounded page, phone on silent). Playback would then just
  // sit there looking broken, so the screen says what happened instead.
  const [audioStuck, setAudioStuck] = useState(false)
  const watchdogRef = useRef<number | null>(null)
  /** Watches for audio that never reaches the speaker: an utterance the engine
   * accepted but never started (`speaking` never turns true), which is how iOS
   * fails. Polling beats a plain timeout — a queue that stays `pending` forever
   * looks busy but is just as broken. */
  const armWatchdog = () => {
    clearWatchdog()
    setAudioStuck(false) // every new attempt (play, skip, replay) gets a clean slate
    const startedAt = Date.now()
    watchdogRef.current = window.setInterval(() => {
      if (!playingRef.current) return clearWatchdog()
      if (speechSpeaking()) return clearWatchdog() // audio is really out
      if (Date.now() - startedAt >= SPEECH_WATCHDOG_MS) {
        clearWatchdog()
        setAudioStuck(true)
      }
    }, 250)
  }
  const clearWatchdog = () => {
    if (watchdogRef.current !== null) { window.clearInterval(watchdogRef.current); watchdogRef.current = null }
  }

  const clearPending = () => {
    if (timeoutRef.current !== null) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null }
  }
  const cancelSpeech = () => {
    runRef.current++
    clearPending()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
  }
  const stop = () => {
    cancelSpeech()
    clearWatchdog()
    setPlaying(false)
    playingRef.current = false // as in start(): the ref must lead the committed state
  }

  const playFrom = (start: number) => {
    const list = playlistRef.current
    const run = ++runRef.current
    const step = (j: number) => {
      if (runRef.current !== run || list.length === 0) return
      const n = ((j % list.length) + list.length) % list.length
      const item = list[n]
      setIdx(n)
      // Duolingo courses list several meanings per word; reading the whole list
      // aloud is noise, so only the first one is spoken (the card shows them all).
      const spokenTranslation = translationParts(item.translation, splitRef.current)[0] ?? item.translation
      const speakTranslation = (cb?: () => void) => speakText(spokenTranslation, transLangRef.current, cb)
      const first = (cb: () => void) =>
        reverseRef.current ? speakTranslation(cb) : speakHebrew(item.hebrew, cb)
      const second = (cb: () => void) =>
        reverseRef.current ? speakHebrew(item.hebrew, cb) : speakTranslation(cb)
      armWatchdog()
      first(() => {
        if (runRef.current !== run) return
        clearWatchdog()
        timeoutRef.current = window.setTimeout(() => {
          if (runRef.current !== run) return
          second(() => {
            if (runRef.current !== run) return
            // the pair played through: this is the only place an exposure counts,
            // so skipping ahead or pausing mid-pair earns nothing
            if (item.wordId) {
              dispatch({ type: 'heard', wordIds: [item.wordId], reverse: reverseRef.current, today: todayRef.current })
            }
            timeoutRef.current = window.setTimeout(() => step(n + 1), pausesRef.current.gapSec * 1000)
          })
        }, pauseAfterMs(reverseRef.current ? item.translation : item.hebrew, pausesRef.current.pauseSec * 1000))
      })
    }
    step(start)
  }

  const start = () => {
    if (playlistRef.current.length === 0) return
    setPlaying(true)
    playingRef.current = true // the watchdog runs before React commits the state
    playFrom(idxRef.current)
  }
  const toggle = () => (playingRef.current ? stop() : start())

  const goTo = (delta: number) => {
    const list = playlistRef.current
    if (list.length === 0) return
    const n = (((idxRef.current + delta) % list.length) + list.length) % list.length
    idxRef.current = n
    setIdx(n)
    if (playingRef.current) {
      playFrom(n)
    } else {
      cancelSpeech()
      const it = list[n]
      if (it) {
        reverseRef.current
          ? speakText(translationParts(it.translation, splitRef.current)[0] ?? it.translation, transLangRef.current)
          : speakHebrew(it.hebrew)
      }
    }
  }

  const cur = playlist.length > 0 ? playlist[Math.min(idx, playlist.length - 1)] : undefined
  const curRating = cur?.wordId ? state.listenRatings[cur.wordId] ?? 0 : 0

  /** ▲ harder to recognize: vote up and replay the current pair to lock it in */
  const rateHard = () => {
    if (!cur?.wordId) return
    dispatch({ type: 'rateListen', wordId: cur.wordId, delta: 1 })
    haptic()
    goTo(0)
  }
  /** ▼ easy: vote down, then move on after a short beat of silence */
  const rateEasy = () => {
    if (!cur?.wordId) return
    dispatch({ type: 'rateListen', wordId: cur.wordId, delta: -1 })
    haptic()
    cancelSpeech()
    timeoutRef.current = window.setTimeout(() => goTo(1), EASY_ADVANCE_MS)
  }

  const toggleShuffle = () => setShuffled((s) => { if (!s) setShuffleNonce((n) => n + 1); return !s })
  const setRatedOrder = (on: boolean) =>
    dispatch({ type: 'setSettings', settings: { ...state.settings, listenRatedOrder: on } })

  // changing filters / order rebuilds the list — restart cleanly from the top
  useEffect(() => {
    cancelSpeech()
    setPlaying(false)
    setIdx(0)
    idxRef.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, category, shuffled, shuffleNonce, ratedOrder])

  useEffect(() => { setRevealed(false) }, [idx])

  const canReport = !!onReportWord
  const flagCurrent = () => {
    if (!cur?.wordId || !onReportWord) return
    const w = wordById.get(cur.wordId)
    if (!w) return
    onReportWord(w); haptic()
    setFlaggedIds((s) => new Set(s).add(cur.wordId!))
  }
  const { pressing, ms, handlers } = useLongPress(toggle, () => canReport && flagCurrent())

  useEffect(() => {
    if (!playing || timerMin === 0) { setLeftSec(null); return }
    const endAt = Date.now() + timerMin * 60_000
    setLeftSec(timerMin * 60)
    const iv = window.setInterval(() => {
      const left = Math.max(0, Math.round((endAt - Date.now()) / 1000))
      setLeftSec(left)
      if (left <= 0) stop()
    }, 1000)
    return () => window.clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timerMin])

  useEffect(() => {
    if (!playing) return
    const iv = window.setInterval(() => dispatch({ type: 'activeTime', seconds: 30, today }), 30_000)
    return () => window.clearInterval(iv)
  }, [playing, today, dispatch])

  // Coming back from the background: iOS suspends the speech engine and never
  // resumes it, so the loop would sit silent on the word it was reading. Restart
  // that word — only when the engine really is idle, so a healthy browser that
  // kept speaking isn't interrupted.
  useEffect(() => {
    if (!playing) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !playingRef.current) return
      window.setTimeout(() => {
        if (playingRef.current && !speechBusy()) playFrom(idxRef.current)
      }, 300)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), [])

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const heardToday = todayLog(state, today).heard ?? 0

  return (
    <div className="panel center autolisten">
      <div className="al-topbar">
        <span className="al-title">🎧 Listening</span>
        <span className="muted small al-topinfo">
          {leftSec !== null && <b className="timer-left">{fmt(leftSec)} </b>}
          {heardToday > 0 && <>{heardToday} today</>}
        </span>
        <button className="icon-btn" title="Listening settings" aria-label="Listening settings" onClick={() => setSheetOpen(true)}>
          ⚙
        </button>
      </div>

      {!canSpeakHebrew() && (
        <p className="muted small">⚠️ No voice found for this course's language — install a system voice first.</p>
      )}
      {canSpeakHebrew() && !canSpeakLang(translationLang) && (
        <p className="muted small">
          ⚠️ No {translationLang} voice on this device — translations will be read by another
          voice and sound wrong. Install one in the system speech settings.
        </p>
      )}

      {playlist.length === 0 ? (
        <p className="muted" style={{ margin: '24px 0' }}>
          Nothing to play with these filters — try “All topics” or start a session to add words.
        </p>
      ) : (
        <>
          <div
            className="autolisten-card tappable"
            role="button"
            aria-label={revealed ? 'Hide translation' : 'Show translation'}
            onClick={() => setRevealed((r) => !r)}
          >
            {cur && (
              <>
                <div className={rtl ? 'he big-he' : 'big-he'}>
                  {cur.hebrew}
                  {cur.wordId && flaggedIds.has(cur.wordId) && <span className="flag-badge" title="Flagged for fix"> ❗</span>}
                </div>
                <div className={`al-translation ${revealed ? '' : 'hidden'}`}>
                  {revealed ? cur.translation : 'tap to reveal'}
                </div>
              </>
            )}
            <div className="autolisten-pos small">
              <span>{idx + 1} / {playlist.length}</span>
              {curRating !== 0 && (
                <span className={`rating-badge ${curRating > 0 ? 'hard' : 'easy'}`}>
                  {curRating > 0 ? `+${curRating}` : curRating}
                </span>
              )}
            </div>
          </div>

          <div className="rate-row" role="group" aria-label="Recognition difficulty">
            <button
              className="rate-btn easy"
              disabled={!cur?.wordId || curRating <= LISTEN_RATING_MIN}
              title="Easy to recognize — plays later"
              onClick={rateEasy}
            >
              <span className="rate-arrows">⌄⌄</span>
              <span className="rate-label">easy</span>
            </button>
            <button
              className="rate-btn hard"
              disabled={!cur?.wordId || curRating >= LISTEN_RATING_MAX}
              title="Hard to recognize — plays first"
              onClick={rateHard}
            >
              <span className="rate-arrows">⌃⌃</span>
              <span className="rate-label">hard</span>
            </button>
          </div>

          <div className="transport" role="group" aria-label="Playback controls">
            <button className="tbtn" title="Previous" aria-label="Previous" onClick={() => goTo(-1)}>‹</button>
            <button
              className="play holdable"
              title={canReport ? 'Tap: play / pause · Hold: flag pronunciation' : 'Play / pause'}
              aria-label={playing ? 'Pause' : 'Play'}
              {...handlers}
            >
              {playing ? '⏸' : '▶'}
              {pressing && <HoldRing ms={ms} />}
            </button>
            <button className="tbtn" title="Next" aria-label="Next" onClick={() => goTo(1)}>›</button>
          </div>

          {audioStuck && (
            <div className="audio-stuck">
              <b>No sound is coming out.</b> Check the phone isn’t on silent, then tap ▶ again.
              If it stays quiet, reload the page — Safari sometimes stops speaking after the
              app has been in the background.
              <button className="ghost" onClick={() => window.location.reload()}>↻ Reload</button>
            </div>
          )}

          <p className="muted small al-hint">
            {playing && wake === 'held' && 'screen stays awake'}
            {playing && wake === 'refused' && (wakeLockSupported()
              ? '⚠️ the screen lock was refused (battery saver / low power mode?) — playback stops when the screen locks'
              : '⚠️ this browser can’t hold the screen awake — playback stops when the screen locks')}
          </p>
        </>
      )}

      {sheetOpen && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div className="sheet" role="dialog" aria-label="Listening settings" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-head">
              <h3>Listening settings</h3>
              <button className="icon-btn" aria-label="Close" onClick={() => setSheetOpen(false)}>✕</button>
            </div>

            {hasSentences && (
              <div className="segmented full" role="group" aria-label="What to play">
                {CONTENT_OPTS.map(([val, label]) => (
                  <button key={val} className={content === val ? 'on' : ''} onClick={() => setContent(val)}>{label}</button>
                ))}
              </div>
            )}
            <div className="al-grid">
              <label className="al-field" title="Which topic to listen to">
                <span className="al-ico">📂</span>
                <select value={category ?? ''} onChange={(e) => setCategory(e.target.value || null)}>
                  <option value="">All topics</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="al-field" title="Auto-stop timer">
                <span className="al-ico">⏱</span>
                <select value={timerMin} onChange={(e) => setTimerMin(Number(e.target.value))}>
                  {TIMER_CHOICES.map((m) => <option key={m} value={m}>{m === 0 ? 'No timer' : `${m} min`}</option>)}
                </select>
              </label>
            </div>
            <div className="al-grid">
              <label className="switch al-switch" title="Off: reviews first, in order · On: random order">
                <span className="switch-label">🔀 Shuffle</span>
                <input type="checkbox" checked={shuffled} onChange={toggleShuffle} />
                <span className="slider" />
              </label>
              <label
                className={`switch al-switch ${shuffled ? '' : 'disabled'}`}
                title="Shuffle plays your hardest-rated words first and the easiest last"
              >
                <span className="switch-label">🎯 Hardest first</span>
                <input type="checkbox" checked={ratedOrder} disabled={!shuffled} onChange={() => setRatedOrder(!ratedOrder)} />
                <span className="slider" />
              </label>
            </div>
            <div className="al-grid">
              <label className="switch al-switch" title="Swap order: translation first">
                <span className="switch-label">↔ Reverse</span>
                <input type="checkbox" checked={reverse} onChange={() => setReverse((r) => !r)} />
                <span className="slider" />
              </label>
            </div>
            <div className="al-grid">
              <label className="al-field" title="a — pause between the word and its translation (longer phrases get 1.5×)">
                <span className="al-ico pause-key">a</span>
                <select value={pauseSec} onChange={(e) => setPause('listenPauseSec', Number(e.target.value))}>
                  {PAUSE_CHOICES.map((n) => <option key={n} value={n}>{n}s</option>)}
                </select>
              </label>
              <label className="al-field" title="b — pause after the translation, before the next word">
                <span className="al-ico pause-key">b</span>
                <select value={gapSec} onChange={(e) => setPause('listenGapSec', Number(e.target.value))}>
                  {PAUSE_CHOICES.map((n) => <option key={n} value={n}>{n}s</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
