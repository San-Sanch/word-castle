import type { GameState } from '../lib/game'
import type { Word } from '../lib/types'
import { computeStreak } from '../lib/time'
import { MAX_BOX } from '../lib/srs'

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
  const attacks = [...state.attacks].slice(-10).reverse()

  return (
    <>
      <div className="panel">
        <h2>📊 Progress</h2>
        <div className="row-gap" style={{ gap: 26 }}>
          <div>
            <div className="summary-num">{rec.length}</div>
            <div className="muted">words started (of {words.length})</div>
          </div>
          <div>
            <div className="summary-num">{state.graduatedIds.length}</div>
            <div className="muted">graduated 🧱</div>
          </div>
          <div>
            <div className="summary-num">{computeStreak(state.dayLogs, today)}</div>
            <div className="muted">day streak 🔥</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Words by memory level</h2>
        <p className="muted">Blue: recognition (He→translation). Gold: recall (translation→He).</p>
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
        <p className="muted">Boxes 0–{MAX_BOX}: review intervals of 0, 1, 2, 4, 8, 16, 32, 64 days.</p>
      </div>

      <div className="panel">
        <h2>Last days</h2>
        <table>
          <thead>
            <tr><th>Date</th><th>Cards</th><th>Correct</th><th>Minutes</th><th>Coins</th><th>Graduated</th></tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.date}>
                <td>{l.date}</td>
                <td>{l.cardsAnswered}</td>
                <td>{l.cardsAnswered ? Math.round((l.correct / l.cardsAnswered) * 100) : 0}%</td>
                <td>{Math.floor(l.activeSeconds / 60)}</td>
                <td>🪙{l.coinsEarned}</td>
                <td>{l.graduated || ''}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={6} className="muted">No sessions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Attack log</h2>
        <table>
          <thead>
            <tr><th>Date</th><th>Type</th><th>Result</th><th>Coins</th></tr>
          </thead>
          <tbody>
            {attacks.map((a) => (
              <tr key={a.id}>
                <td>{a.date}</td>
                <td>{a.kind === 'raid' ? '🌙 raid' : '⚔️ attack'}</td>
                <td>{a.result}</td>
                <td>{a.coinsDelta > 0 ? `+${a.coinsDelta}` : a.coinsDelta}</td>
              </tr>
            ))}
            {attacks.length === 0 && (
              <tr><td colSpan={4} className="muted">Quiet so far…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
