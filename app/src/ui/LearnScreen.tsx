import type { GameState } from '../lib/game'
import type { Word } from '../lib/types'

const TOPIC_EMOJI: Record<string, string> = {
  'Family': '👨‍👩‍👧',
  'Food & Drinks': '🍎',
  'Weather': '⛅',
  'Verbs': '🏃',
  'Numbers & Time': '🕐',
  'Politeness': '🙏',
  'Places & Countries': '🌍',
  'Question Words': '❓',
  'School / Ulpan': '🎓',
  'Personal Pronouns': '👤',
  'Possessive Pronouns': '🤲',
  'Preposition ל': '➡️',
  'Home & Apartment': '🏠',
  'Public Places': '🏛️',
  'Adjectives & Adverbs': '🎨',
  'Adjectives': '🖌️',
  'Prepositions & Function': '🔗',
  'Nature': '🌿',
}

export interface TopicInfo {
  name: string
  total: number
  started: number
  mastered: number
  due: number
}

export function topicInfos(words: Word[], state: GameState, today: string): TopicInfo[] {
  const byTopic = new Map<string, TopicInfo>()
  const wordTopic = new Map(words.map((w) => [w.id, w.category]))
  for (const w of words) {
    const t = byTopic.get(w.category) ?? { name: w.category, total: 0, started: 0, mastered: 0, due: 0 }
    t.total++
    byTopic.set(w.category, t)
  }
  const started = new Set<string>()
  for (const r of state.reviews) {
    if (r.direction !== 'recognition' || started.has(r.wordId)) continue
    started.add(r.wordId)
    const t = byTopic.get(wordTopic.get(r.wordId) ?? '')
    if (t) t.started++
  }
  const dueCounted = new Set<string>()
  for (const r of state.reviews) {
    if (r.dueAt > today) continue
    const key = `${r.wordId}|${r.direction}`
    if (dueCounted.has(key)) continue
    dueCounted.add(key)
    const t = byTopic.get(wordTopic.get(r.wordId) ?? '')
    if (t) t.due++
  }
  for (const id of state.graduatedIds) {
    const t = byTopic.get(wordTopic.get(id) ?? '')
    if (t) t.mastered++
  }
  return [...byTopic.values()].sort((a, b) => b.started - a.started || b.total - a.total)
}

export default function LearnScreen(props: {
  state: GameState
  words: Word[]
  today: string
  onStartSession: (topic: string | null) => void
  onSpeedRound: () => void
}) {
  const { state, words, today, onStartSession, onSpeedRound } = props
  const topics = topicInfos(words, state, today)
  const dueTotal = topics.reduce((n, t) => n + t.due, 0)
  const startedTotal = topics.reduce((n, t) => n + t.started, 0)
  const canSpeed = startedTotal >= 8

  return (
    <>
      <div className="panel center hero">
        <button className="primary big" onClick={() => onStartSession(null)}>
          ▶ Daily session
        </button>
        <p className="muted" style={{ marginBottom: 0 }}>
          {dueTotal > 0
            ? `${dueTotal} words are waiting for review · new words from all topics`
            : 'Nothing due right now — start to pick up new words'}
        </p>
        {canSpeed && (
          <button className="ghost" style={{ marginTop: 10 }} onClick={onSpeedRound}>
            ⚡ Speed round (60s)
          </button>
        )}
      </div>

      <h2 className="section-title">Topics</h2>
      <div className="topics-grid">
        {topics.map((t) => {
          const pct = t.total ? Math.round((t.mastered / t.total) * 100) : 0
          const startedPct = t.total ? Math.round((t.started / t.total) * 100) : 0
          return (
            <div key={t.name} className="topic-card" onClick={() => onStartSession(t.name)}>
              <div className="topic-head">
                <span className="topic-emoji">{TOPIC_EMOJI[t.name] ?? '📖'}</span>
                <span className="topic-name">{t.name}</span>
                {t.due > 0 && <span className="due-badge">{t.due} due</span>}
              </div>
              <div className="topic-bar">
                <div className="started" style={{ width: `${startedPct}%` }} />
                <div className="mastered" style={{ width: `${pct}%` }} />
              </div>
              <div className="muted topic-stats">
                {t.mastered} mastered · {t.started}/{t.total} started
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
