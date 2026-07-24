import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { GameAction, GameState } from '../lib/game'
import type { Sentence, Word } from '../lib/types'
import { buildAutoPlaylist, pauseAfterMs, GAP_AFTER_PAIR_MS, type ListenContent } from '../lib/autoListen'
import { speakHebrew, speakText, canSpeakHebrew } from '../lib/speech'
import { fetchWordErrors } from '../lib/wixClient'
import { useLongPress } from './useLongPress'
import { HoldRing } from './HoldRing'

const TIMER_CHOICES = [0, 5, 10, 15, 30] // minutes, 0 = until stopped
const CONTENT_OPTS: Array<[ListenContent, string]> = [
  ['words', 'Words'],
  ['both', 'Both'],
  ['sentences', 'Sentences'],
]

function haptic() {
  try { (navigator as unknown as { vibrate?: (n: number) => void }).vibrate?.(40) } catch { /* no haptics */ }
}

export default function AutoListenScreen(props: {
  state: GameState
  words: Word[]
  sentences: Sentence[]
  today: string
  dispatch: Dispatch<GameAction>
  onExit: () => void
  /** flag the current word as mispronounced (Hebrew course only) */
  onReportWord?: (word: Word) => void
}) {
  const { state, words, sentences, today, dispatch, onExit, onReportWord } = props
  const wordById = useMemo(() => new Map(words.map((w) => [w.id, w])), [words])
  const categories = useMemo(() => {
    const seen: string[] = []
    for (const w of words) if (!seen.includes(w.category)) seen.push(w.category)
    return seen
  }, [words])
  const hasSentences = sentences.length > 0

  const [content, setContent] = useState<ListenContent>('words')
  const [category, setCategory] = useState<string | null>(null)
  const [shuffled, setShuffled] = useState(false)
  const [shuffleNonce, setShuffleNonce] = useState(0)

  // ordered by default (reviews first); a fresh random order only when shuffled
  const playlist = useMemo(
    () => buildAutoPlaylist({
      words, reviews: state.reviews, sentences, content, category,
      categoryBias: state.settings.categoryBias, shuffle: shuffled, rng: Math.random,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words, sentences, state.reviews, content, category, state.settings.categoryBias, shuffled, shuffleNonce],
  )

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
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

  const clearPending = () => {
    if (timeoutRef.current !== null) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null }
  }
  const cancelSpeech = () => {
    runRef.current++
    clearPending()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
  }
  const stop = () => { cancelSpeech(); setPlaying(false) }

  const playFrom = (start: number) => {
    const list = playlistRef.current
    const run = ++runRef.current
    const step = (j: number) => {
      if (runRef.current !== run || list.length === 0) return
      const n = ((j % list.length) + list.length) % list.length
      const item = list[n]
      setIdx(n)
      const first = (cb: () => void) =>
        reverseRef.current ? speakText(item.translation, 'en-US', cb) : speakHebrew(item.hebrew, cb)
      const second = (cb: () => void) =>
        reverseRef.current ? speakHebrew(item.hebrew, cb) : speakText(item.translation, 'en-US', cb)
      first(() => {
        if (runRef.current !== run) return
        timeoutRef.current = window.setTimeout(() => {
          if (runRef.current !== run) return
          second(() => {
            if (runRef.current !== run) return
            timeoutRef.current = window.setTimeout(() => step(n + 1), GAP_AFTER_PAIR_MS)
          })
        }, pauseAfterMs(reverseRef.current ? item.translation : item.hebrew))
      })
    }
    step(start)
  }

  const start = () => {
    if (playlistRef.current.length === 0) return
    setPlaying(true)
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
      if (it) reverseRef.current ? speakText(it.translation, 'en-US') : speakHebrew(it.hebrew)
    }
  }

  const toggleShuffle = () => setShuffled((s) => { if (!s) setShuffleNonce((n) => n + 1); return !s })

  // changing filters / order rebuilds the list — restart cleanly from the top
  useEffect(() => {
    cancelSpeech()
    setPlaying(false)
    setIdx(0)
    idxRef.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, category, shuffled, shuffleNonce])

  const cur = playlist.length > 0 ? playlist[Math.min(idx, playlist.length - 1)] : undefined
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), [])

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="panel center autolisten">
      <h2 style={{ marginTop: 0 }}>🎧 Auto listening</h2>

      {!canSpeakHebrew() && (
        <p className="muted small">⚠️ No voice found for this course's language — install a system voice first.</p>
      )}

      {playlist.length === 0 ? (
        <p className="muted" style={{ margin: '24px 0' }}>
          Nothing to play with these filters — try “All topics” or start a session to add words.
        </p>
      ) : (
        <>
          <div className="autolisten-card">
            {cur && (
              <>
                <div className="he big-he">
                  {cur.hebrew}
                  {cur.wordId && flaggedIds.has(cur.wordId) && <span className="flag-badge" title="Flagged for fix"> ❗</span>}
                </div>
                <div className="muted">{cur.translation}</div>
              </>
            )}
            <div className="autolisten-pos small">{idx + 1} / {playlist.length}</div>
          </div>

          <div className="transport" role="group" aria-label="Playback controls">
            <button className="tbtn" title="Back 5" onClick={() => goTo(-5)}>−5</button>
            <button className="tbtn" title="Previous" onClick={() => goTo(-1)}>‹</button>
            <button
              className="play holdable"
              title={canReport ? 'Tap: play / pause · Hold: flag pronunciation' : 'Play / pause'}
              aria-label={playing ? 'Pause' : 'Play'}
              {...handlers}
            >
              {playing ? '⏸' : '▶'}
              {pressing && <HoldRing ms={ms} />}
            </button>
            <button className="tbtn" title="Next" onClick={() => goTo(1)}>›</button>
            <button className="tbtn" title="Forward 5" onClick={() => goTo(5)}>+5</button>
          </div>
        </>
      )}

      <div className="al-settings">
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
            {leftSec !== null && <b className="timer-left">{fmt(leftSec)}</b>}
          </label>
        </div>
        <div className="al-grid">
          <label className="switch al-switch" title="Swap order: translation first">
            <span className="switch-label">↔ Reverse</span>
            <input type="checkbox" checked={reverse} onChange={() => setReverse((r) => !r)} />
            <span className="slider" />
          </label>
          <label className="switch al-switch" title="Off: reviews first, in order · On: random order">
            <span className="switch-label">🔀 Shuffle</span>
            <input type="checkbox" checked={shuffled} onChange={toggleShuffle} />
            <span className="slider" />
          </label>
        </div>
      </div>

      <button className="ghost done-link" onClick={() => { stop(); onExit() }}>← Done</button>
    </div>
  )
}
