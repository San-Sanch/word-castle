import type { GameState } from '../lib/game'
import type { StudyMode, Word } from '../lib/types'
import { canSpeakHebrew } from '../lib/speech'
import { REVERSIBLE_MODES, modeAvailable, type CourseCaps } from './SessionScreen'

const MODES: Array<[StudyMode, string, string]> = [
  ['mixed', '🎯', 'Smart mix'],
  ['random', '🎲', 'Random'],
  ['flashcards', '🃏', 'Flashcards'],
  ['listening', '🎧', 'Listening'],
  ['matching', '🧩', 'Matching'],
  ['sentences', '💬', 'Sentences'],
  ['blanks', '📝', 'Missing word'],
  ['crossword', '🔠', 'Crossword'],
  ['memory', '🎴', 'Memory'],
  ['builder', '🏗️', 'Builder'],
  ['story', '📚', 'Story'],
  ['original', '🔍', 'Find original'],
]

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
  // semantic taxonomy shared by the Duolingo-derived courses (English/Spanish)
  'People & Family': '👨‍👩‍👧',
  'Body & Health': '🩺',
  'Food & Drink': '🍎',
  'Home & Living': '🏠',
  'Clothing & Accessories': '👕',
  'Animals & Nature': '🐾',
  'Weather & Environment': '⛅',
  'Places & Buildings': '🏛️',
  'Travel & Transport': '✈️',
  'Time & Calendar': '🕐',
  'Numbers & Quantity': '🔢',
  'Money & Shopping': '🛒',
  'Work & Business': '💼',
  'School & Learning': '🎓',
  'Technology & Media': '💻',
  'Communication & Language': '💬',
  'Emotions & Feelings': '❤️',
  'Common Verbs & Actions': '🏃',
  'Movement & Direction': '🧭',
  'Descriptions & Qualities': '🎨',
  'Grammar & Function Words': '🔗',
  'Phrases & Expressions': '💡',
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
  caps: CourseCaps
  today: string
  onStartSession: (topic: string | null, mode?: 'normal' | 'more-new' | 'practice') => void
  onSpeedRound: () => void
  onSetStudyMode: (mode: StudyMode) => void
  onToggleReverse: () => void
}) {
  const { state, words, caps, today, onStartSession, onSpeedRound, onSetStudyMode, onToggleReverse } = props
  const modes = MODES.filter(([m]) => modeAvailable(m, caps))
  const topics = topicInfos(words, state, today)
  const dueTotal = topics.reduce((n, t) => n + t.due, 0)
  const startedTotal = topics.reduce((n, t) => n + t.started, 0)
  const canSpeed = startedTotal >= 8
  const introducedToday = state.reviews.filter((r) => r.direction === 'recognition' && r.introducedAt === today).length
  const planDone = dueTotal === 0 && introducedToday >= state.settings.newWordsPerDay

  return (
    <>
      <div className="panel center hero">
        <div className="mode-chips">
          {modes.map(([m, ico, label]) => {
            const disabled = m === 'listening' && !canSpeakHebrew()
            return (
              <button
                key={m}
                className={`chip ${state.settings.studyMode === m ? 'active' : ''}`}
                disabled={disabled}
                title={disabled ? 'Needs a Hebrew system voice' : ''}
                onClick={() => onSetStudyMode(m)}
              >
                {ico} {label}
              </button>
            )
          })}
          <label
            className={`switch ${REVERSIBLE_MODES.has(state.settings.studyMode) ? '' : 'disabled'}`}
            title={
              REVERSIBLE_MODES.has(state.settings.studyMode)
                ? 'Swap directions: prompts in English, answers in Hebrew'
                : 'This mode has no direction to swap'
            }
          >
            <span className="switch-label">↔ Reverse</span>
            <input
              type="checkbox"
              checked={state.settings.reverse}
              disabled={!REVERSIBLE_MODES.has(state.settings.studyMode)}
              onChange={onToggleReverse}
            />
            <span className="slider" />
          </label>
        </div>
        <button className="primary big" onClick={() => onStartSession(null, planDone ? 'more-new' : 'normal')}>
          {planDone ? '➕ Keep learning' : '▶ Daily session'}
        </button>
        <p className="muted" style={{ marginBottom: 0 }}>
          {dueTotal > 0
            ? `${dueTotal} words are waiting for review · new words from all topics`
            : planDone
              ? `Daily plan done (${introducedToday} new words) — keep going as long as you like`
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
