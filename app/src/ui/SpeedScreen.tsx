// Speed round: 60 seconds of rapid multiple choice over words already studied.
// Pure practice mode: no SRS effect, just reflexes and a score to beat.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameState } from '../lib/game'
import type { Word } from '../lib/types'
import { makeChoice, mulberry32, type ChoiceExercise } from '../lib/exercises'

const SECONDS = 60

export default function SpeedScreen(props: {
  state: GameState
  words: Word[]
  onExit: () => void
}) {
  const { state, words, onExit } = props
  const rng = useRef(mulberry32((Date.now() ^ 0x51ed270b) >>> 0)).current
  const pool = useMemo(() => {
    const studied = new Set(state.reviews.map((r) => r.wordId))
    const list = words.filter((w) => studied.has(w.id))
    return list.length >= 8 ? list : words.slice(0, 40)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [left, setLeft] = useState(SECONDS)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(0)
  const [ex, setEx] = useState<ChoiceExercise | null>(null)
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null)

  const next = () => {
    const w = pool[Math.floor(rng() * pool.length)]
    // same rules as listening: 8 options, shape-matched distractors
    setEx(makeChoice(w, rng() < 0.5 ? 'recognition' : 'recall', words, rng, 8))
  }
  useEffect(() => {
    next()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (left <= 0) return
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [left])

  const answer = (i: number) => {
    if (!ex || left <= 0) return
    if (i === ex.correctIndex) {
      const gained = 1 + Math.floor(streak / 5)
      setScore((s) => s + gained)
      setStreak((s) => {
        setBest((b) => Math.max(b, s + 1))
        return s + 1
      })
      setFlash('good')
    } else {
      setStreak(0)
      setFlash('bad')
    }
    window.setTimeout(() => setFlash(null), 200)
    next()
  }

  if (left <= 0) {
    return (
      <div className="panel card">
        <p className="prompt small">⚡ Time!</p>
        <div className="row-gap" style={{ justifyContent: 'center', gap: 30 }}>
          <div>
            <div className="summary-num">{score}</div>
            <div className="muted">points</div>
          </div>
          <div>
            <div className="summary-num">{best}</div>
            <div className="muted">best streak</div>
          </div>
        </div>
        <button className="primary" style={{ marginTop: 18 }} onClick={onExit}>
          Done
        </button>
      </div>
    )
  }

  return (
    <div className={`panel card ${flash === 'good' ? 'flash-good' : flash === 'bad' ? 'flash-bad' : ''}`}>
      <div className="progress">
        <span className="lightning-timer">⏱ {left}s</span>
        <span>
          {score} pts {streak >= 5 && <span className="combo">x{1 + Math.floor(streak / 5)}</span>}
        </span>
      </div>
      {ex && (
        <>
          <div className={`prompt ${ex.direction === 'recognition' ? 'he' : ''}`}>{ex.prompt}</div>
          <div className="options">
            {ex.options.map((o, i) => (
              <button key={i} className={ex.direction === 'recall' ? 'he' : ''} onClick={() => answer(i)}>
                {o}
              </button>
            ))}
          </div>
        </>
      )}
      <button className="ghost" style={{ marginTop: 16, fontSize: 12 }} onClick={onExit}>
        Quit
      </button>
    </div>
  )
}
