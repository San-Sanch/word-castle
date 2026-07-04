import type { GameState } from '../lib/game'
import type { Word } from '../lib/types'
import { computeStreak } from '../lib/time'
import { MAX_BOX } from '../lib/srs'
import { topicInfos } from './LearnScreen'

export default function StatsScreen(props: { state: GameState; words: Word[]; today: string }) {
  const { state, words, today } = props
  const rec = state.reviews.filter((r) => r.direction === 'recognition')
  const rc = state.reviews.filter((r) => r.direction === 'recall')
  const boxCounts = (dir: typeof rec) => {
    const counts = Array(MAX_BOX + 1).fill(0) as number[]
    for (const r of dir) counts[r.box]++
    return counts
  }
  const recCounts = boxCounts(rec)
  const rcCounts = boxCounts(rc)
  const maxCount = Math.max(1, ...recCounts, ...rcCounts)
  const logs = [...state.dayLogs].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 14)
  const topics = topicInfos(words, state, today)
  const totalMinutes = state.dayLogs.reduce((n, l) => n + l.activeSeconds, 0) / 60

  return (
    <>
      <div className="panel">
        <h2>📊 Progress</h2>
        <div className="row-gap" style={{ gap: 26 }}>
          <div>
            <div className="summary-num">{state.graduatedIds.length}</div>
            <div className="muted">words mastered 🎓</div>
          </div>
          <div>
            <div className="summary-num">{rec.length}</div>
            <div className="muted">started (of {words.length})</div>
          </div>
          <div>
            <div className="summary-num">{computeStreak(state.dayLogs, today)}</div>
            <div className="muted">day streak 🔥</div>
          </div>
          <div>
            <div className="summary-num">{Math.round(totalMinutes / 60 * 10) / 10}h</div>
            <div className="muted">total practice</div>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          A word counts as <b>mastered</b> when you recognize it AND recall it from the translation
          across several spaced reviews (recall level 4+).
        </p>
      </div>

      <div className="panel">
        <h2>Topics</h2>
        <table>
          <thead>
            <tr><th>Topic</th><th>Mastered</th><th>Started</th><th>Total</th><th></th></tr>
          </thead>
          <tbody>
            {topics.map((t) => (
              <tr key={t.name}>
                <td>{t.name}</td>
                <td>{t.mastered}</td>
                <td>{t.started}</td>
                <td>{t.total}</td>
                <td style={{ width: '30%' }}>
                  <div className="topic-bar">
                    <div className="started" style={{ width: `${t.total ? (t.started / t.total) * 100 : 0}%` }} />
                    <div className="mastered" style={{ width: `${t.total ? (t.mastered / t.total) * 100 : 0}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Words by memory level</h2>
        <p className="muted">Blue: recognition (He→En). Gold: recall (En→He). Boxes are review intervals: 0, 1, 2, 4, 8, 16, 32, 64 days.</p>
        <div className="boxbar">
          {recCounts.map((c, i) => (
            <div key={`r${i}`} className="b" style={{ height: `${(c / maxCount) * 100}%` }}>
              <span>{c || ''}</span>
            </div>
          ))}
        </div>
        <div className="boxbar" style={{ height: 60 }}>
          {rcCounts.map((c, i) => (
            <div key={`c${i}`} className="b recall" style={{ height: `${(c / maxCount) * 100}%` }}>
              <span>{c || ''}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Last days</h2>
        <table>
          <thead>
            <tr><th>Date</th><th>Cards</th><th>Correct</th><th>Minutes</th><th>Mastered</th></tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.date}>
                <td>{l.date}</td>
                <td>{l.cardsAnswered}</td>
                <td>{l.cardsAnswered ? Math.round((l.correct / l.cardsAnswered) * 100) : 0}%</td>
                <td>{Math.floor(l.activeSeconds / 60)}</td>
                <td>{l.graduated || ''}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={5} className="muted">No sessions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
