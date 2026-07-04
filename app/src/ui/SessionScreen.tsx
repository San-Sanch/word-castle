import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { GameState, GameAction } from '../lib/game'
import { introducedTodayCount, todayLog } from '../lib/game'
import type { Sentence, Word, Direction } from '../lib/types'
import { buildSessionPlan } from '../lib/srs'
import { buildTrainingSet } from '../lib/guardian'
import {
  makeChoice,
  makeBlank,
  makeMatch,
  mulberry32,
  pickExerciseKind,
  type ChoiceExercise,
  type BlankExercise,
  type MatchExercise,
} from '../lib/exercises'
import { answerReward } from '../lib/economy'
import { castleDefense, lightningTarget, resolveSessionAttack, rollSeverity } from '../lib/attack'
import { todayISO } from '../lib/time'

interface QueueItem {
  wordId: string
  direction: Direction
  intro: boolean
  firstTry: boolean
}

type CurrentEx = { kind: 'intro'; word: Word } | ChoiceExercise | BlankExercise

type Phase = 'cards' | 'attack-intro' | 'lightning' | 'attack-result' | 'match' | 'summary' | 'empty'

const LIGHTNING_SECONDS = 60

export default function SessionScreen(props: {
  state: GameState
  dispatch: Dispatch<GameAction>
  words: Word[]
  sentences: Sentence[]
  training: boolean
  onExit: () => void
}) {
  const { state, dispatch, words, sentences, training, onExit } = props
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
    if (training) {
      if (!state.guardian) return []
      return buildTrainingSet(state.reviews, words, state.guardian.category, today).map((s) => ({
        wordId: s.wordId,
        direction: s.direction,
        intro: false,
        firstTry: true,
      }))
    }
    const plan = buildSessionPlan({
      words,
      states: state.reviews,
      today,
      settings: state.settings,
      introducedToday: introducedTodayCount(state, today),
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

  const [attackAt] = useState<number>(() => {
    if (training || items.length < 6 || !state.settings.exercises.lightning) return -1
    return rng() * 100 < state.settings.attackChancePct ? Math.floor(items.length / 2) : -1
  })

  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>(items.length === 0 ? 'empty' : 'cards')
  const [ex, setEx] = useState<CurrentEx | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [sessionAnswered, setSessionAnswered] = useState(0)
  const [answeredWordIds, setAnsweredWordIds] = useState<string[]>([])
  const trainingReported = useRef(false)

  // --- attack state ---
  const [severity] = useState(() => rollSeverity(rng))
  const defense = castleDefense(state.castle) + (state.guardian?.level ?? 0)
  const target = lightningTarget(severity, defense)
  const [lightningLeft, setLightningLeft] = useState(LIGHTNING_SECONDS)
  const [lightningCorrect, setLightningCorrect] = useState(0)
  const [lightningStreak, setLightningStreak] = useState(0)
  const [attackOutcome, setAttackOutcome] = useState<ReturnType<typeof resolveSessionAttack> | null>(null)

  // --- match state ---
  const [match, setMatch] = useState<MatchExercise | null>(null)
  const [matchSel, setMatchSel] = useState<{ side: 'l' | 'r'; pair: number } | null>(null)
  const [matchDone, setMatchDone] = useState<number[]>([])
  const [matchFlash, setMatchFlash] = useState<number | null>(null)

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

  // generate exercise whenever the current card changes
  useEffect(() => {
    if (phase !== 'cards' || idx >= items.length) return
    setEx(genExercise(items[idx]))
    setPicked(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items, phase])

  const advance = (nextItems: QueueItem[]) => {
    const next = idx + 1
    if (next === attackAt) {
      setIdx(next)
      setPhase('attack-intro')
      return
    }
    if (next >= nextItems.length) {
      if (!training && state.settings.exercises.match && answeredWordIds.length >= 5) {
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
      setPhase('summary')
      return
    }
    setIdx(next)
  }

  // training completion reported once, on reaching the summary
  useEffect(() => {
    if (phase === 'summary' && training && !trainingReported.current) {
      trainingReported.current = true
      dispatch({ type: 'trainingCompleted' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, training])

  // lightning countdown
  useEffect(() => {
    if (phase !== 'lightning') return
    if (lightningLeft <= 0) {
      const outcome = resolveSessionAttack({ target, correct: lightningCorrect, coins: state.wallet.coins, rng })
      setAttackOutcome(outcome)
      dispatch({
        type: 'applyAttack',
        kind: 'session',
        severity,
        defense,
        result: outcome.result,
        coinsDelta: outcome.coinsDelta,
        ruin: outcome.ruin,
        today,
      })
      setPhase('attack-result')
      return
    }
    const t = window.setTimeout(() => setLightningLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, lightningLeft])

  // lightning exercise generation
  const lightningPool = useMemo(() => {
    const reviewed = state.reviews.map((r) => r.wordId)
    const unique = [...new Set(reviewed)]
    return (unique.length >= 8 ? unique : words.slice(0, 50).map((w) => w.id)).map((id) => wordById.get(id)!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [lightningEx, setLightningEx] = useState<ChoiceExercise | null>(null)
  useEffect(() => {
    if (phase === 'lightning' && !lightningEx) {
      const w = lightningPool[Math.floor(rng() * lightningPool.length)]
      setLightningEx(makeChoice(w, rng() < 0.5 ? 'recognition' : 'recall', words, rng))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, lightningEx])

  const combo = Math.min(3, 1 + Math.floor(lightningStreak / 5))

  const answerLightning = (i: number) => {
    touch()
    if (!lightningEx) return
    const correct = i === lightningEx.correctIndex
    if (correct) {
      setLightningCorrect((c) => c + 1)
      setLightningStreak((s) => s + 1)
      dispatch({ type: 'bonusCoins', amount: answerReward('lightning', false, combo), today })
    } else {
      setLightningStreak(0)
    }
    setLightningEx(null)
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
    setAnsweredWordIds((list) => [...list, item.wordId])
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
    if (!match || matchDone.includes(pair) === true) {
      // fallthrough: clicking a finished tile does nothing
    }
    if (!match || matchDone.includes(pair)) return
    if (!matchSel) {
      setMatchSel({ side, pair })
      return
    }
    if (matchSel.side === side) {
      setMatchSel({ side, pair })
      return
    }
    if (matchSel.pair === pair) {
      setMatchDone((d) => [...d, pair])
      setMatchSel(null)
      dispatch({ type: 'bonusCoins', amount: answerReward('match', false), today })
      if (matchDone.length + 1 === match.pairs.length) {
        window.setTimeout(() => setPhase('summary'), 600)
      }
    } else {
      setMatchFlash(pair)
      window.setTimeout(() => setMatchFlash(null), 400)
      setMatchSel(null)
    }
  }

  const log = todayLog(state, today)

  // ---------- render ----------

  if (phase === 'empty') {
    return (
      <div className="panel card">
        <p>
          {training
            ? 'No guardian or no words in the guardian category yet.'
            : 'Nothing due and no new words available. Come back tomorrow!'}
        </p>
        <button className="primary" onClick={onExit}>Back</button>
      </div>
    )
  }

  if (phase === 'attack-intro') {
    return (
      <div className="panel card">
        <span className="badge attack">⚔️ ATTACK</span>
        <p className="prompt small">Raiders at the gate!</p>
        <p>
          Severity {severity} vs your defense {defense}.<br />
          Answer <b>{target}</b> questions correctly in {LIGHTNING_SECONDS} seconds to drive them off!
        </p>
        <button className="primary" onClick={() => { touch(); setPhase('lightning') }}>
          ⚡ Defend!
        </button>
      </div>
    )
  }

  if (phase === 'lightning') {
    return (
      <div className="panel card">
        <div className="progress">
          <span className="lightning-timer">⏱ {lightningLeft}s</span>
          <span>
            {lightningCorrect}/{target} {combo > 1 && <span className="combo">x{combo}</span>}
          </span>
        </div>
        {lightningEx && (
          <>
            <div className={`prompt ${lightningEx.direction === 'recognition' ? 'he' : ''}`}>{lightningEx.prompt}</div>
            <div className="options">
              {lightningEx.options.map((o, i) => (
                <button key={i} className={lightningEx.direction === 'recall' ? 'he' : ''} onClick={() => answerLightning(i)}>
                  {o}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  if (phase === 'attack-result' && attackOutcome) {
    return (
      <div className="panel card">
        {attackOutcome.result === 'win' && (
          <>
            <p className="prompt small">🏆 Victory!</p>
            <p>The raiders flee. You loot 🪙{attackOutcome.coinsDelta}.</p>
          </>
        )}
        {attackOutcome.result === 'coin-loss' && (
          <>
            <p className="prompt small">😖 They broke through…</p>
            <p>The raiders grabbed 🪙{-attackOutcome.coinsDelta} before your guardian pushed them out.</p>
          </>
        )}
        {attackOutcome.result === 'ruin' && (
          <>
            <p className="prompt small">💥 Disaster!</p>
            <p>Your latest upgrade is in ruins. Rebuild it from the castle screen at half price.</p>
          </>
        )}
        <button className="primary" onClick={() => { touch(); idx >= items.length ? setPhase('summary') : setPhase('cards') }}>
          Continue
        </button>
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

  if (phase === 'summary') {
    return (
      <div className="panel card">
        <p className="prompt small">Session complete 🎉</p>
        <div className="row-gap" style={{ justifyContent: 'center', gap: 30 }}>
          <div>
            <div className="summary-num">{sessionAnswered}</div>
            <div className="muted">cards</div>
          </div>
          <div>
            <div className="summary-num">🪙{log.coinsEarned}</div>
            <div className="muted">today</div>
          </div>
          <div>
            <div className="summary-num">{Math.floor(log.activeSeconds / 60)}m</div>
            <div className="muted">active</div>
          </div>
        </div>
        {training && <p>🛡️ Training set completed! Your guardian grows stronger.</p>}
        <button className="primary" style={{ marginTop: 18 }} onClick={onExit}>
          {training ? 'Back to guardian' : 'Back to castle'}
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
          {training ? '🛡️ Training' : 'Session'} · card {Math.min(idx + 1, items.length)}/{items.length}
        </span>
        <button className="ghost" onClick={onExit} style={{ fontSize: 12, padding: '4px 10px' }}>
          End session
        </button>
      </div>

      {ex.kind === 'intro' && (
        <div className="panel card newword">
          <span className="badge new">✨ New word</span>
          <div className="prompt he">{ex.word.hebrew}</div>
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
          <div className={`prompt ${ex.direction === 'recognition' ? 'he' : 'small'}`}>{ex.prompt}</div>
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
                  {picked !== null ? ex.options[ex.correctIndex] : ' '}
                </span>
              ) : (
                <span key={i}> {t} </span>
              ),
            )}
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
