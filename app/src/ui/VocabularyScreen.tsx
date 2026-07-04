import { useMemo, useState } from 'react'
import type { GameState } from '../lib/game'
import type { Word } from '../lib/types'
import { todayISO } from '../lib/time'
import { canSpeakHebrew, speakHebrew } from '../lib/speech'
import translitJson from '../data/translit.json'

const TRANSLIT = translitJson as Record<string, { he: string; plural?: string }>

type Status = 'new' | 'learning' | 'mastered'
type SortKey = 'category' | 'alpha' | 'progress' | 'difficulty' | 'due' | 'recent'

interface Row {
  word: Word
  translit: string
  status: Status
  due: boolean
  recBox: number
  recallBox: number
  progress: number
  lapses: number
  startedAt: string | null
  dueAt: string | null
}

export default function VocabularyScreen(props: { state: GameState; words: Word[] }) {
  const { state, words } = props
  const today = todayISO()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState<SortKey>('category')

  const rows = useMemo<Row[]>(() => {
    const byWord = new Map<string, { rec?: { box: number; dueAt: string; lapses: number; introducedAt: string }; recall?: { box: number; dueAt: string; lapses: number } }>()
    for (const r of state.reviews) {
      const entry = byWord.get(r.wordId) ?? {}
      if (r.direction === 'recognition') entry.rec = r
      else entry.recall = r
      byWord.set(r.wordId, entry)
    }
    const mastered = new Set(state.graduatedIds)
    return words.map((word) => {
      const rv = byWord.get(word.id)
      const recBox = rv?.rec?.box ?? 0
      const recallBox = rv?.recall?.box ?? 0
      const lapses = (rv?.rec?.lapses ?? 0) + (rv?.recall?.lapses ?? 0)
      const dueDates = [rv?.rec?.dueAt, rv?.recall?.dueAt].filter(Boolean) as string[]
      const st: Status = mastered.has(word.id) ? 'mastered' : rv ? 'learning' : 'new'
      return {
        word,
        translit: TRANSLIT[word.id]?.he ?? '',
        status: st,
        due: dueDates.some((d) => d <= today),
        recBox,
        recallBox,
        progress: recBox + recallBox,
        lapses,
        startedAt: rv?.rec?.introducedAt ?? null,
        dueAt: dueDates.length ? dueDates.sort()[0] : null,
      }
    })
  }, [state.reviews, state.graduatedIds, words, today])

  const categories = useMemo(() => [...new Set(words.map((w) => w.category))].sort(), [words])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = rows.filter((r) => {
      if (category !== 'all' && r.word.category !== category) return false
      if (status === 'new' && r.status !== 'new') return false
      if (status === 'learning' && r.status !== 'learning') return false
      if (status === 'mastered' && r.status !== 'mastered') return false
      if (status === 'due' && !r.due) return false
      if (status === 'difficult' && r.lapses === 0) return false
      if (q) {
        const hay = `${r.word.hebrew} ${r.word.hebrewFull} ${r.word.translation} ${r.translit} ${r.word.category}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
      category: (a, b) => a.word.category.localeCompare(b.word.category) || a.word.hebrew.localeCompare(b.word.hebrew, 'he'),
      alpha: (a, b) => a.word.hebrew.localeCompare(b.word.hebrew, 'he'),
      progress: (a, b) => b.progress - a.progress || b.recBox - a.recBox,
      difficulty: (a, b) => b.lapses - a.lapses || b.progress - a.progress,
      due: (a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'),
      recent: (a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''),
    }
    return [...list].sort(cmp[sort])
  }, [rows, search, category, status, sort])

  const counts = useMemo(() => {
    const learning = rows.filter((r) => r.status === 'learning').length
    const mastered = rows.filter((r) => r.status === 'mastered').length
    return { learning, mastered, total: rows.length }
  }, [rows])

  const Box = ({ n }: { n: number }) => (
    <span className="boxdots" title={`memory level ${n}/7`}>
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  )

  return (
    <>
      <div className="panel">
        <h2>📖 Vocabulary</h2>
        <p className="muted">
          {counts.total} words · {counts.learning} learning · {counts.mastered} mastered
        </p>
        <div className="vocab-controls">
          <input
            placeholder="Search Hebrew, translation, transcription…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All topics</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Any status</option>
            <option value="new">Not started</option>
            <option value="learning">Learning</option>
            <option value="mastered">Mastered</option>
            <option value="due">Due for review</option>
            <option value="difficult">With mistakes</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="category">Sort: topic</option>
            <option value="alpha">Sort: alphabet (א-ת)</option>
            <option value="progress">Sort: best known</option>
            <option value="difficulty">Sort: most mistakes</option>
            <option value="due">Sort: next review</option>
            <option value="recent">Sort: recently started</option>
          </select>
        </div>
      </div>

      <div className="panel vocab-table-wrap">
        <table className="vocab-table">
          <thead>
            <tr>
              <th></th>
              <th>Hebrew</th>
              <th>Transcription</th>
              <th>Translation</th>
              <th>Topic</th>
              <th title="recognition He→En">Recog.</th>
              <th title="recall En→He">Recall</th>
              <th title="total wrong answers">Mistakes</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.word.id}>
                <td>
                  {canSpeakHebrew() && (
                    <button className="speak" onClick={() => speakHebrew(r.word.hebrew)}>🔊</button>
                  )}
                </td>
                <td className="he vocab-he">
                  {r.word.hebrew}
                  {r.word.gender && <span className="muted"> ({r.word.gender === 'm' ? 'ז׳' : 'נ׳'})</span>}
                </td>
                <td className="translit-cell">{r.translit}</td>
                <td>{r.word.translation}</td>
                <td className="muted">{r.word.category}</td>
                <td><Box n={r.recBox} /></td>
                <td><Box n={r.recallBox} /></td>
                <td className={r.lapses > 2 ? 'hard' : ''}>{r.lapses || ''}</td>
                <td>
                  {r.status === 'mastered' && <span className="status-badge mastered">🎓</span>}
                  {r.status === 'learning' && (r.due ? <span className="status-badge due">due</span> : <span className="status-badge learning">learning</span>)}
                  {r.status === 'new' && <span className="status-badge fresh">new</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="muted">Nothing matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
