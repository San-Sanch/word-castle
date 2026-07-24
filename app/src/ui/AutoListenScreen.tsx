import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { GameAction, GameState } from '../lib/game'
import type { Word } from '../lib/types'
import { buildAutoPlaylist, pauseAfterMs, GAP_AFTER_PAIR_MS } from '../lib/autoListen'
import { speakHebrew, speakText, canSpeakHebrew } from '../lib/speech'

const TIMER_CHOICES = [0, 5, 10, 15, 30] // minutes, 0 = until stopped

export default function AutoListenScreen(props: {
  state: GameState
  words: Word[]
  today: string
  dispatch: Dispatch<GameAction>
  onExit: () => void
}) {
  const { state, words, today, dispatch, onExit } = props
  const playlist = useMemo(() => buildAutoPlaylist(words, state.reviews), [words, state.reviews])
  const wordById = useMemo(() => new Map(words.map((w) => [w.id, w])), [words])

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [reverse, setReverse] = useState(false)
  const [timerMin, setTimerMin] = useState(0)
  const [leftSec, setLeftSec] = useState<number | null>(null)

  const runRef = useRef(0) // bumping it cancels any in-flight speak/pause chain
  const timeoutRef = useRef<number | null>(null)
  const reverseRef = useRef(reverse)
  reverseRef.current = reverse
  const idxRef = useRef(idx)
  idxRef.current = idx

  const clearPending = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const stop = () => {
    runRef.current++
    clearPending()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    setPlaying(false)
  }

  const playFrom = (start: number) => {
    const run = ++runRef.current
    const step = (j: number) => {
      if (runRef.current !== run || playlist.length === 0) return
      const word = wordById.get(playlist[j % playlist.length])
      if (!word) return
      setIdx(j % playlist.length)
      const first = (cb: () => void) =>
        reverseRef.current ? speakText(word.translation, 'en-US', cb) : speakHebrew(word.hebrew, cb)
      const second = (cb: () => void) =>
        reverseRef.current ? speakHebrew(word.hebrew, cb) : speakText(word.translation, 'en-US', cb)
      first(() => {
        if (runRef.current !== run) return
        timeoutRef.current = window.setTimeout(() => {
          if (runRef.current !== run) return
          second(() => {
            if (runRef.current !== run) return
            timeoutRef.current = window.setTimeout(() => step(j + 1), GAP_AFTER_PAIR_MS)
          })
        }, pauseAfterMs(reverseRef.current ? word.translation : word.hebrew))
      })
    }
    step(start)
  }

  const start = () => {
    if (playlist.length === 0) return
    setPlaying(true)
    playFrom(idxRef.current)
  }

  // countdown when a timer is chosen; hitting zero stops the loop
  useEffect(() => {
    if (!playing || timerMin === 0) {
      setLeftSec(null)
      return
    }
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

  // passive listening still counts toward the daily active-minutes goal
  useEffect(() => {
    if (!playing) return
    const iv = window.setInterval(() => dispatch({ type: 'activeTime', seconds: 30, today }), 30_000)
    return () => window.clearInterval(iv)
  }, [playing, today, dispatch])

  // never keep speaking after leaving the screen
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), [])

  const cur = playlist.length > 0 ? wordById.get(playlist[idx]) : undefined
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="panel center">
      <h2>🎧 Auto listening</h2>
      {playlist.length === 0 ? (
        <>
          <p className="muted">No words in learning yet — do a session first, then come back to listen.</p>
          <button className="ghost" onClick={onExit}>← Back</button>
        </>
      ) : (
        <>
          {!canSpeakHebrew() && (
            <p className="muted">⚠️ No voice found for this course's language — install a system voice first.</p>
          )}
          <p className="muted">
            {reverse ? 'Translation first, then the word' : 'Word first, then the translation'} · {playlist.length}{' '}
            words on repeat, reviews first
          </p>
          {cur && (
            <div className="autolisten-word">
              <div className="he big-he">{cur.hebrew}</div>
              <div className="muted">{cur.translation}</div>
            </div>
          )}
          <div className="row-gap" style={{ justifyContent: 'center', marginTop: 12 }}>
            {playing ? (
              <button className="primary big" onClick={stop}>⏸ Pause</button>
            ) : (
              <button className="primary big" onClick={start}>▶ {idx > 0 ? 'Resume' : 'Start'}</button>
            )}
            <button
              className={`ghost ${reverse ? 'active' : ''}`}
              title="Swap order: translation first, then the word"
              onClick={() => setReverse((r) => !r)}
            >
              ↔ Reverse {reverse ? 'on' : 'off'}
            </button>
          </div>
          <div className="row-gap" style={{ justifyContent: 'center', marginTop: 12, alignItems: 'center' }}>
            <span className="muted">Timer:</span>
            {TIMER_CHOICES.map((m) => (
              <button
                key={m}
                className={`chip ${timerMin === m ? 'active' : ''}`}
                onClick={() => setTimerMin(m)}
              >
                {m === 0 ? '∞' : `${m}m`}
              </button>
            ))}
            {leftSec !== null && <b>{fmt(leftSec)}</b>}
          </div>
          <button className="ghost" style={{ marginTop: 16 }} onClick={() => { stop(); onExit() }}>
            ← Done
          </button>
        </>
      )}
    </div>
  )
}
