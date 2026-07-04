import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { GameState, GameAction } from '../lib/game'
import { introducedTodayCount, todayLog } from '../lib/game'
import type { Sentence, Word, Direction } from '../lib/types'
import { buildSessionPlan } from '../lib/srs'
import {
  makeChoice,
  makeBlank,
  makeMatch,
  makeSoundMatch,
  mulberry32,
  pickExerciseKind,
  type ChoiceExercise,
  type BlankExercise,
  type MatchExercise,
  type SoundExercise,
} from '../lib/exercises'
import { todayISO } from '../lib/time'
import { canSpeakHebrew, speakHebrew } from '../lib/speech'

interface QueueItem {
  wordId: string
  direction: Direction
  intro: boolean
  firstTry: boolean
}

type CurrentEx = { kind: 'intro'; word: Word } | ChoiceExercise | BlankExercise

type Phase = 'cards' | 'match' | 'sound' | 'summary' | 'empty'

const SOUND_QUESTIONS = 5

function SpeakButton(props: { text: string }) {
  if (!canSpeakHebrew()) return null
  return (
    <button
      className="speak"
      title="Play pronunciation"
      onClick={(e) => {
        e.stopPropagation()
        speakHebrew(props.text)
      }}
    >
      🔊
    </button>
  )
}

export default function SessionScreen(props: {
  state: GameState
  dispatch: Dispatch<GameAction>
  words: Word[]
  sentences: Sentence[]
  topic: string | null
  onExit: () => void
}) {
  const { state, dispatch, words, sentences, topic, onExit } = props
  const today = todayISO()
  const rng = useRef(mulberry32((Date.now() ^ 0x9e3779b9) >>> 0)).current
  const wordById = useMemo(() => new Map(words.map((w) => [w.id, w])), [words])
  const sentencesByWord = useMemo(() => {
    const m = new Map<string, Array<{ sentence: Sentence; tokenIndex: number }>>()
    for (const s of sentences) {
      for (const match of s.matches) {
        const list = m.get(match.wordId) ?? []
        list.push({ sentence: s, tokenIndex: match.tokenIndex })
        m.set(match.wordId, list)
      }
    }
    return m
  }, [sentences])

  const [items, setItems] = useState<QueueItem[]>(() => {
    const plan = buildSessionPlan({
      words,
      states: state.reviews,
      today,
      settings: state.settings,
      introducedToday: introducedTodayCount(state, today),
      topic,
    })
    const due: QueueItem[] = plan.dueStates.map((s) => ({
      wordId: s.wordId,
      direction: s.direction,
      intro: false,
      firstTry: true,
    }))
    const fresh: QueueItem[] = plan.newWordIds.flatMap((id) => [
      { wordId: id, direction: 'recognition' as const, intro: true, firstTry: true },
      { wordId: id, direction: 'recognition' as const, intro: false, firstTry: true },
    ])
    return [...due, ...fresh]
  })

  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>(items.length === 0 ? 'empty' : 'cards')
  const [ex, setEx] = useState<CurrentEx | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [sessionAnswered, setSessionAnswered] = useState(0)
  const [sessionCorrect, setSessionCorrect] = useState(0)
  const [answeredWordIds, setAnsweredWordIds] = useState<string[]>([])
  const masteredAtStart = useRef(todayLog(state, today).graduated)

  // --- match state ---
  const [match, setMatch] = useState<MatchExercise | null>(null)
  const [matchSel, setMatchSel] = useState<{ side: 'l' | 'r'; pair: number } | null>(null)
  const [matchDone, setMatchDone] = useState<number[]>([])
  const [matchFlash, setMatchFlash] = useState<number | null>(null)

  // --- sound round state ---
  const [soundQs, setSoundQs] = useState<SoundExercise[]>([])
  const [soundIdx, setSoundIdx] = useState(0)
  const [soundPicked, setSoundPicked] = useState<number | null>(null)

  // --- active time tracking ---
  const lastInteraction = useRef(Date.now())
  useEffect(() => {
    let buffer = 0
    const flush = () => {
      if (buffer > 0) {
        dispatch({ type: 'activeTime', seconds: buffer, today: todayISO() })
        buffer = 0
      }
    }
    const tick = window.setInterval(() => {
      if (!document.hidden && Date.now() - lastInteraction.current < 30000) buffer++
      if (buffer >= 10) flush()
    }, 1000)
    return () => {
      window.clearInterval(tick)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const touch = () => {
    lastInteraction.current = Date.now()
  }

  const genExercise = (item: QueueItem): CurrentEx => {
    const word = wordById.get(item.wordId)!
    if (item.intro) return { kind: 'intro', word }
    const review = state.reviews.find((r) => r.wordId === item.wordId && r.direction === item.direction)
    const box = review?.box ?? 0
    const withSentence = sentencesByWord.get(item.wordId) ?? []
    const kind = pickExerciseKind({
      box,
      hasSentence: withSentence.length > 0,
      settings: { choice: state.settings.exercises.choice, blank: state.settings.exercises.blank },
      roll: rng(),
    })
    if (kind === 'blank') {
      const pick = withSentence[Math.floor(rng() * withSentence.length)]
      return makeBlank(pick.sentence, { tokenIndex: pick.tokenIndex, wordId: item.wordId }, words, rng)
    }
    return makeChoice(word, item.direction, words, rng)
  }

  useEffect(() => {
    if (phase !== 'cards' || idx >= items.length) return
    setEx(genExercise(items[idx]))
    setPicked(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items, phase])

  // pronounce new words when their intro card appears
  useEffect(() => {
    if (phase === 'cards' && ex?.kind === 'intro' && canSpeakHebrew()) speakHebrew(ex.word.hebrew)
  }, [phase, ex])

  const soundRoundPossible = () =>
    state.settings.exercises.sound && canSpeakHebrew() && [...new Set(answeredWordIds)].length >= 3

  const enterBonusOrSummary = (after: 'cards' | 'match') => {
    if (after === 'cards' && state.settings.exercises.match) {
      const pool = [...new Set(answeredWordIds)]
      if (pool.length >= 5) {
        const chosen = pool
          .sort(() => rng() - 0.5)
          .slice(0, 5)
          .map((id) => wordById.get(id)!)
        setMatch(makeMatch(chosen, rng))
        setPhase('match')
        return
      }
    }
    if (soundRoundPossible()) {
      const pool = [...new Set(answeredWordIds)]
      const chosen = pool
        .sort(() => rng() - 0.5)
        .slice(0, SOUND_QUESTIONS)
        .map((id) => wordById.get(id)!)
      setSoundQs(chosen.map((w) => makeSoundMatch(w, words, rng)))
      setSoundIdx(0)
      setSoundPicked(null)
      setPhase('sound')
      return
    }
    setPhase('summary')
  }

  const advance = (nextItems: QueueItem[]) => {
    const next = idx + 1
    if (next >= nextItems.length) {
      enterBonusOrSummary('cards')
      return
    }
    setIdx(next)
  }

  const answerCard = (i: number) => {
    touch()
    if (picked !== null || !ex || ex.kind === 'intro') return
    setPicked(i)
    const item = items[idx]
    const correct = i === ex.correctIndex
    dispatch({
      type: 'answer',
      wordId: item.wordId,
      direction: item.direction,
      correct,
      firstTry: item.firstTry,
      rewardKind: ex.kind === 'blank' ? 'blank' : 'choice',
      today,
    })
    setSessionAnswered((n) => n + 1)
    if (correct) setSessionCorrect((n) => n + 1)
    setAnsweredWordIds((list) => [...list, item.wordId])
    const word = wordById.get(item.wordId)
    if (word && ex.kind === 'choice' && canSpeakHebrew()) speakHebrew(word.hebrew)
    let nextItems = items
    if (!correct) {
      const requeued: QueueItem = { ...item, intro: false, firstTry: false }
      const at = Math.min(idx + 3, items.length)
      nextItems = [...items.slice(0, at), requeued, ...items.slice(at)]
      setItems(nextItems)
    }
    window.setTimeout(() => advance(nextItems), correct ? 650 : 1500)
  }

  const clickMatch = (side: 'l' | 'r', pair: number) => {
    touch()
    if (!match || matchDone.includes(pair)) return
    if (!matchSel || matchSel.side === side) {
      setMatchSel({ side, pair })
      return
    }
    if (matchSel.pair === pair) {
      setMatchDone((d) => [...d, pair])
      setMatchSel(null)
      if (matchDone.length + 1 === match.pairs.length) {
        window.setTimeout(() => enterBonusOrSummary('match'), 600)
      }
    } else {
      setMatchFlash(pair)
      window.setTimeout(() => setMatchFlash(null), 400)
      setMatchSel(null)
    }
  }

  useEffect(() => {
    if (phase === 'sound' && soundQs[soundIdx]) speakHebrew(soundQs[soundIdx].hebrew)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, soundIdx])

  const answerSound = (i: number) => {
    touch()
    if (soundPicked !== null) return
    const q = soundQs[soundIdx]
    setSoundPicked(i)
    window.setTimeout(() => {
      if (soundIdx + 1 >= soundQs.length) {
        setPhase('summary')
      } else {
        setSoundIdx((n) => n + 1)
        setSoundPicked(null)
      }
    }, i === q.correctIndex ? 700 : 1400)
  }

  const log = todayLog(state, today)

  // ---------- render ----------

  if (phase === 'empty') {
    return (
      <div className="panel card">
        <p>
          {topic
            ? `Nothing to do in “${topic}” right now: no due reviews and the daily new-word limit is used up.`
            : 'Nothing due and no new words available. Come back tomorrow!'}
        </p>
        <button className="primary" onClick={onExit}>Back</button>
      </div>
    )
  }

  if (phase === 'match' && match) {
    return (
      <div className="panel card">
        <span className="badge">🎁 Bonus round: match the pairs</span>
        <div className="match-cols" style={{ marginTop: 16 }}>
          <div className="col">
            {match.leftOrder.map((p) => (
              <button
                key={`l${p}`}
                className={`he ${matchSel?.side === 'l' && matchSel.pair === p ? 'sel' : ''} ${matchDone.includes(p) ? 'done' : ''} ${matchFlash === p ? 'flash' : ''}`}
                onClick={() => clickMatch('l', p)}
              >
                {match.pairs[p].hebrew}
              </button>
            ))}
          </div>
          <div className="col">
            {match.rightOrder.map((p) => (
              <button
                key={`r${p}`}
                className={`${matchSel?.side === 'r' && matchSel.pair === p ? 'sel' : ''} ${matchDone.includes(p) ? 'done' : ''} ${matchFlash === p ? 'flash' : ''}`}
                onClick={() => clickMatch('r', p)}
              >
                {match.pairs[p].translation}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'sound' && soundQs[soundIdx]) {
    const q = soundQs[soundIdx]
    return (
      <div className="panel card">
        <span className="badge">🎧 Bonus round: pick the word you hear ({soundIdx + 1}/{soundQs.length})</span>
        <div style={{ margin: '22px 0' }}>
          <button className="primary" onClick={() => { touch(); speakHebrew(q.hebrew) }}>
            🔊 Play again
          </button>
        </div>
        <div className="options sound-options">
          {q.options.map((o, i) => (
            <button
              key={i}
              className={`he ${soundPicked !== null && i === q.correctIndex ? 'correct' : soundPicked === i ? 'wrong' : ''}`}
              disabled={soundPicked !== null}
              onClick={() => answerSound(i)}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (phase === 'summary') {
    const mastered = log.graduated - masteredAtStart.current
    const accuracy = sessionAnswered ? Math.round((sessionCorrect / sessionAnswered) * 100) : 0
    return (
      <div className="panel card">
        <p className="prompt small">Session complete 🎉</p>
        <div className="row-gap" style={{ justifyContent: 'center', gap: 30 }}>
          <div>
            <div className="summary-num">{sessionAnswered}</div>
            <div className="muted">cards</div>
          </div>
          <div>
            <div className="summary-num">{accuracy}%</div>
            <div className="muted">correct</div>
          </div>
          <div>
            <div className="summary-num">{Math.floor(log.activeSeconds / 60)}m</div>
            <div className="muted">today</div>
          </div>
        </div>
        {mastered > 0 && (
          <p style={{ marginTop: 14 }}>
            🎓 <b>{mastered}</b> {mastered === 1 ? 'word' : 'words'} fully mastered this session!
          </p>
        )}
        <button className="primary" style={{ marginTop: 18 }} onClick={onExit}>
          Done
        </button>
      </div>
    )
  }

  // cards phase
  if (!ex) return null
  const item = items[idx]

  return (
    <>
      <div className="progress">
        <span>
          {topic ? `📖 ${topic}` : 'Session'} · card {Math.min(idx + 1, items.length)}/{items.length}
        </span>
        <button className="ghost" onClick={onExit} style={{ fontSize: 12, padding: '4px 10px' }}>
          End session
        </button>
      </div>

      {ex.kind === 'intro' && (
        <div className="panel card newword">
          <span className="badge new">✨ New word</span>
          <div className="prompt he">
            {ex.word.hebrew} <SpeakButton text={ex.word.hebrew} />
          </div>
          {(ex.word.gender || ex.word.plural) && (
            <div className="sub">
              {ex.word.gender === 'm' && 'masculine (ז׳)'}
              {ex.word.gender === 'f' && 'feminine (נ׳)'}
              {ex.word.plural && (
                <>
                  {' '}· plural: <span className="he">{ex.word.plural}</span>
                </>
              )}
            </div>
          )}
          <div className="prompt small">{ex.word.translation}</div>
          <div className="sub">{ex.word.category}</div>
          <button
            className="primary"
            onClick={() => {
              touch()
              dispatch({ type: 'introduce', wordId: item.wordId, today })
              advance(items)
            }}
          >
            Got it →
          </button>
        </div>
      )}

      {ex.kind === 'choice' && (
        <div className="panel card">
          <div className={`prompt ${ex.direction === 'recognition' ? 'he' : 'small'}`}>
            {ex.prompt} {ex.direction === 'recognition' && <SpeakButton text={ex.prompt} />}
          </div>
          <div className="sub">{ex.direction === 'recognition' ? 'What does it mean?' : 'Pick the Hebrew word'}</div>
          <div className="options">
            {ex.options.map((o, i) => (
              <button
                key={i}
                className={`${ex.direction === 'recall' ? 'he' : ''} ${
                  picked !== null && i === ex.correctIndex ? 'correct' : picked === i ? 'wrong' : ''
                }`}
                disabled={picked !== null}
                onClick={() => answerCard(i)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}

      {ex.kind === 'blank' && (
        <div className="panel card">
          <div className="sentence he">
            {ex.tokens.map((t, i) =>
              i === ex.blankIndex ? (
                <span key={i} className="blank">
                  {picked !== null ? ex.options[ex.correctIndex] : ' '}
                </span>
              ) : (
                <span key={i}> {t} </span>
              ),
            )}
            {picked !== null && <SpeakButton text={ex.tokens.map((t, i) => (i === ex.blankIndex ? ex.options[ex.correctIndex] : t)).join(' ')} />}
          </div>
          <div className="sub">{ex.translation}</div>
          <div className="options">
            {ex.options.map((o, i) => (
              <button
                key={i}
                className={`he ${picked !== null && i === ex.correctIndex ? 'correct' : picked === i ? 'wrong' : ''}`}
                disabled={picked !== null}
                onClick={() => answerCard(i)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
