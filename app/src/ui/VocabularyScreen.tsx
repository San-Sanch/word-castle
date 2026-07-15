import { Fragment, useEffect, useMemo, useState } from 'react'
import type { GameState } from '../lib/game'
import type { Word } from '../lib/types'
import { todayISO } from '../lib/time'
import { canSpeakHebrew, speakHebrew } from '../lib/speech'
import { errorIcon, type WordErrorStatus } from '../lib/wordErrors'
import { fetchWordErrors, reportWordError, clearWordError } from '../lib/wixClient'
import { useLongPress } from './useLongPress'
import { HoldRing } from './HoldRing'
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

/** Speak button that also reports bad pronunciation on a ~1s hold. */
function VocabSpeak({ word, big, onReport }: { word: Word; big?: boolean; onReport?: (w: Word) => void }) {
  const { pressing, ms, handlers } = useLongPress(
    () => speakHebrew(word.hebrew),
    () => onReport?.(word),
  )
  if (!canSpeakHebrew()) return null
  const cls = big ? 'primary' : 'speak'
  const label = big ? '🔊 Play' : '🔊'
  if (!onReport) {
    return <button className={cls} onClick={(e) => { e.stopPropagation(); speakHebrew(word.hebrew) }}>{label}</button>
  }
  return (
    <button className={`${cls} holdable`} title="Tap: play · Hold: report bad pronunciation" {...handlers}>
      {label}{pressing && <HoldRing ms={ms} />}
    </button>
  )
}

export default function VocabularyScreen(props: { state: GameState; words: Word[]; errorsEnabled: boolean }) {
  const { state, words, errorsEnabled } = props
  const today = todayISO()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState<SortKey>('category')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [errors, setErrors] = useState<Record<string, WordErrorStatus>>({})
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (errorsEnabled) fetchWordErrors().then(setErrors).catch(() => {})
  }, [errorsEnabled])

  const report = (w: Word) => {
    setErrors((e) => ({ ...e, [w.id]: 'error' }))
    reportWordError(w).catch((err) => console.error('report failed', err))
  }
  const unreport = (id: string) => {
    setErrors((e) => { const n = { ...e }; delete n[id]; return n })
    clearWordError(id).catch((err) => console.error('clear failed', err))
  }

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
    const list = rows.filter((r) => {
      if (errorsOnly && !errors[r.word.id]) return false
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
  }, [rows, search, category, status, sort, errorsOnly, errors])

  const counts = useMemo(() => {
    const learning = rows.filter((r) => r.status === 'learning').length
    const mastered = rows.filter((r) => r.status === 'mastered').length
    return { learning, mastered, total: rows.length }
  }, [rows])

  const errorCount = useMemo(() => Object.keys(errors).length, [errors])

  const Box = ({ n }: { n: number }) => (
    <span className="boxdots" title={`memory level ${n}/7`}>
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  )

  const statusLabel = (r: Row) =>
    r.status === 'mastered' ? '🎓 mastered' : r.status === 'learning' ? (r.due ? 'learning · due for review' : 'learning') : 'not started yet'

  return (
    <>
      <div className="panel">
        <h2>📖 Vocabulary</h2>
        <p className="muted">
          {counts.total} words · {counts.learning} learning · {counts.mastered} mastered
          {errorsEnabled && errorCount > 0 && ` · ${errorCount} flagged`}
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
        {errorsEnabled && (
          <label className="vocab-errors-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
            <span>Words with errors {errorCount > 0 ? `(${errorCount})` : ''}</span>
          </label>
        )}
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
            {filtered.map((r) => {
              const flag = errors[r.word.id]
              const isOpen = expanded === r.word.id
              return (
                <Fragment key={r.word.id}>
                  <tr
                    className={`vocab-row ${isOpen ? 'open' : ''}`}
                    onClick={() => setExpanded(isOpen ? null : r.word.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      {errorsEnabled && flag && <span title={flag} style={{ marginRight: 4 }}>{errorIcon(flag)}</span>}
                      <VocabSpeak word={r.word} onReport={errorsEnabled ? report : undefined} />
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
                  {isOpen && (
                    <tr className="vocab-detail-row">
                      <td colSpan={9}>
                        <div className="vocab-detail">
                          <div className="vocab-detail-head">
                            <span className="he vocab-detail-word">{r.word.hebrew}</span>
                            <VocabSpeak word={r.word} big onReport={errorsEnabled ? report : undefined} />
                          </div>
                          {r.translit && <div className="translit">{r.translit}</div>}
                          <div className="vocab-detail-grid">
                            <div><b>Translation:</b> {r.word.translation}</div>
                            {r.word.gender && <div><b>Gender:</b> {r.word.gender === 'm' ? 'masculine (ז׳)' : 'feminine (נ׳)'}</div>}
                            {r.word.plural && <div><b>Plural:</b> <span className="he">{r.word.plural}</span></div>}
                            <div><b>Topic:</b> {r.word.category}</div>
                            <div><b>Status:</b> {statusLabel(r)}</div>
                            <div><b>Recognition:</b> level {r.recBox}/7</div>
                            <div><b>Recall:</b> level {r.recallBox}/7</div>
                            <div><b>Mistakes:</b> {r.lapses}</div>
                            {r.startedAt && <div><b>Started:</b> {r.startedAt}</div>}
                            {r.dueAt && <div><b>Next review:</b> {r.dueAt}</div>}
                          </div>
                          {errorsEnabled && (
                            <div className="vocab-detail-errors" style={{ marginTop: 10 }}>
                              {flag ? (
                                <div className="row-gap" style={{ alignItems: 'center', gap: 10 }}>
                                  <span>{errorIcon(flag)} {flag === 'fixed' ? 'Marked as fixed' : 'Reported — pending fix'}</span>
                                  <button className="ghost" onClick={(e) => { e.stopPropagation(); unreport(r.word.id) }}>Remove from list</button>
                                </div>
                              ) : (
                                <button className="ghost" onClick={(e) => { e.stopPropagation(); report(r.word) }}>🚩 Report bad pronunciation</button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="muted">Nothing matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
