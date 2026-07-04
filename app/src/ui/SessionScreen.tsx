import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { GameState, GameAction } from '../lib/game'
import { introducedTodayCount, todayLog } from '../lib/game'
import type { Sentence, Word, Direction, StudyMode } from '../lib/types'
import { buildSessionPlan } from '../lib/srs'
import {
  makeChoice,
  makeBlank,
  makeMatch,
  makeSoundMatch,
  mulberry32,
  shuffle,
  pickExerciseKind,
  type ChoiceExercise,
  type BlankExercise,
  type MatchExercise,
  type SoundExercise,
} from '../lib/exercises'
import { todayISO } from '../lib/time'
import { canSpeakHebrew, speakHebrew } from '../lib/speech'
import translitJson from '../data/translit.json'

const TRANSLIT = translitJson as Record<string, { he: string; plural?: string }>

interface QueueItem {
  wordId: string
  direction: Direction
  firstTry: boolean
}

type Step = { kind: 'card'; item: QueueItem } | { kind: 'group'; items: QueueItem[] }

type CurrentEx =
  | (ChoiceExercise & { audioOnly?: boolean })
  | BlankExercise
  | SoundExercise
  | { kind: 'flash'; word: Word; direction: Direction }

type Phase = 'steps' | 'match-bonus' | 'sound-bonus' | 'summary' | 'empty'

export type SessionMode = 'normal' | 'more-new' | 'practice'

const SOUND_QUESTIONS = 5
const MODE_LABEL: Record<StudyMode, string> = {
  mixed: '🎯 Session',
  random: '🎲 Random',
  flashcards: '🃏 Flashcards',
  listening: '🎧 Listening',
  matching: '🧩 Matching',
  sentences: '📝 Sentences',
}

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
  mode: SessionMode
  onExit: () => void
  onMoreNew: () => void
  onPractice: () => void
}) {
  const { state, dispatch, words, sentences, topic, mode, onExit, onMoreNew, onPractice } = props
  const today = todayISO()
  const rng = useRef(mulberry32((Date.now() ^ 0x9e3779b9) >>> 0)).current
  const studyMode: StudyMode = canSpeakHebrew() || state.settings.studyMode !== 'listening'
    ? state.settings.studyMode
    : 'mixed'
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

  const buildSteps = (queue: QueueItem[]): Step[] => {
    if (studyMode !== 'matching') return queue.map((item) => ({ kind: 'card', item }))
    // matching: groups of up to 5 with unique words; leftovers become cards
    const steps: Step[] = []
    let group: QueueItem[] = []
    const leftovers: QueueItem[] = []
    for (const item of queue) {
      if (group.some((g) => g.wordId === item.wordId)) {
        leftovers.push(item)
        continue
      }
      group.push(item)
      if (group.length === 5) {
        steps.push({ kind: 'group', items: group })
        group = []
      }
    }
    const rest = [...group, ...leftovers]
    if (rest.length >= 3) {
      steps.push({ kind: 'group', items: rest.slice(0, 5) })
      for (const item of rest.slice(5)) steps.push({ kind: 'card', item })
    } else {
      for (const item of rest) steps.push({ kind: 'card', item })
    }
    return steps
  }

  const [steps, setSteps] = useState<Step[]>(() => {
    // no introduction cards: words go straight into exercises (Sanch knows most
    // of them; unknown ones have the on-demand reveal)
    if (mode === 'practice') {
      const inTopic = topic ? new Set(words.filter((w) => w.category === topic).map((w) => w.id)) : null
      const queue = state.reviews
        .filter((r) => !inTopic || inTopic.has(r.wordId))
        .sort((a, b) => (a.box === b.box ? (a.dueAt < b.dueAt ? -1 : 1) : a.box - b.box))
        .slice(0, state.settings.sessionSize)
        .map((s) => ({ wordId: s.wordId, direction: s.direction, firstTry: true }))
      return buildSteps(queue)
    }
    const plan = buildSessionPlan({
      words,
      states: state.reviews,
      today,
      settings: state.settings,
      introducedToday: introducedTodayCount(state, today),
      topic,
      ignoreNewLimit: mode === 'more-new',
    })
    const due: QueueItem[] = plan.dueStates.map((s) => ({
      wordId: s.wordId,
      direction: s.direction,
      firstTry: true,
    }))
    const fresh: QueueItem[] = plan.newWordIds.map((id) => ({
      wordId: id,
      direction: 'recognition' as const,
      firstTry: true,
    }))
    // interleave new words among reviews so they do not clump at the end
    return buildSteps(shuffle([...due, ...fresh], rng))
  })

  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>(steps.length === 0 ? 'empty' : 'steps')
  const [ex, setEx] = useState<CurrentEx | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false) // flashcards: answer shown
  const [hintWord, setHintWord] = useState<Word | null>(null) // "don't know it" reveal
  const [sessionAnswered, setSessionAnswered] = useState(0)
  const [sessionCorrect, setSessionCorrect] = useState(0)
  const [answeredWordIds, setAnsweredWordIds] = useState<string[]>([])
  const masteredAtStart = useRef(todayLog(state, today).graduated)

  // --- match group state (matching mode) ---
  const [groupEx, setGroupEx] = useState<MatchExercise | null>(null)
  const [matchSel, setMatchSel] = useState<{ side: 'l' | 'r'; pair: number } | null>(null)
  const [matchDone, setMatchDone] = useState<number[]>([])
  const [matchFlash, setMatchFlash] = useState<number | null>(null)
  const mismatched = useRef(new Set<string>())

  // --- end-of-session bonus state (mixed mode only) ---
  const [bonusMatch, setBonusMatch] = useState<MatchExercise | null>(null)
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

  const isNewWord = (wordId: string) =>
    !state.reviews.some((r) => r.wordId === wordId && r.direction === 'recognition')

  const ensureIntroduced = (wordId: string) => {
    if (isNewWord(wordId)) dispatch({ type: 'introduce', wordId, today })
  }

  const genExercise = (item: QueueItem): CurrentEx => {
    const word = wordById.get(item.wordId)!
    if (studyMode === 'flashcards') return { kind: 'flash', word, direction: item.direction }
    if (studyMode === 'listening') {
      if (item.direction === 'recall') return makeSoundMatch(word, words, rng)
      return { ...makeChoice(word, 'recognition', words, rng, 8), audioOnly: true }
    }
    const review = state.reviews.find((r) => r.wordId === item.wordId && r.direction === item.direction)
    const box = review?.box ?? 0
    const withSentence = sentencesByWord.get(item.wordId) ?? []
    if (studyMode === 'random') {
      // any exercise type can come up, per card
      const kinds: Array<'choice' | 'audio-choice' | 'blank' | 'sound' | 'flash'> = ['choice', 'flash']
      if (withSentence.length > 0) kinds.push('blank')
      if (canSpeakHebrew()) kinds.push('sound', 'audio-choice')
      const kind = kinds[Math.floor(rng() * kinds.length)]
      if (kind === 'flash') return { kind: 'flash', word, direction: item.direction }
      if (kind === 'sound') return makeSoundMatch(word, words, rng)
      if (kind === 'audio-choice') return { ...makeChoice(word, 'recognition', words, rng, 8), audioOnly: true }
      if (kind === 'blank') {
        const pick = withSentence[Math.floor(rng() * withSentence.length)]
        return makeBlank(pick.sentence, { tokenIndex: pick.tokenIndex, wordId: item.wordId }, words, rng)
      }
      return makeChoice(word, item.direction, words, rng)
    }
    if (studyMode === 'sentences' && withSentence.length > 0) {
      const pick = withSentence[Math.floor(rng() * withSentence.length)]
      return makeBlank(pick.sentence, { tokenIndex: pick.tokenIndex, wordId: item.wordId }, words, rng)
    }
    if (studyMode === 'mixed') {
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
    }
    return makeChoice(word, item.direction, words, rng)
  }

  // prepare the current step; keyed on the step OBJECT so a requeue (which
  // rebuilds the array but keeps the current element) does not reset the card
  const currentStep: Step | undefined = steps[idx]
  useEffect(() => {
    if (phase !== 'steps' || !currentStep) return
    setPicked(null)
    setRevealed(false)
    setHintWord(null)
    if (currentStep.kind === 'card') {
      ensureIntroduced(currentStep.item.wordId)
      setEx(genExercise(currentStep.item))
    } else {
      for (const item of currentStep.items) ensureIntroduced(item.wordId)
      mismatched.current = new Set()
      setMatchSel(null)
      setMatchDone([])
      setGroupEx(makeMatch(currentStep.items.map((i) => wordById.get(i.wordId)!), rng))
      setEx(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, currentStep, phase])

  // audio-first cards speak themselves
  useEffect(() => {
    if (phase !== 'steps' || !ex) return
    if (ex.kind === 'sound') speakHebrew(ex.hebrew)
    else if (ex.kind === 'choice' && ex.audioOnly) speakHebrew(wordById.get(ex.wordId)!.hebrew)
    else if (ex.kind === 'flash' && ex.direction === 'recognition' && canSpeakHebrew()) speakHebrew(ex.word.hebrew)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ex])

  const dispatchAnswer = (item: QueueItem, correct: boolean, rewardKind: 'choice' | 'blank' | 'sound') => {
    if (mode === 'practice') {
      dispatch({ type: 'practiceAnswer', correct, today })
    } else {
      dispatch({
        type: 'answer',
        wordId: item.wordId,
        direction: item.direction,
        correct,
        firstTry: item.firstTry,
        rewardKind,
        today,
      })
    }
    setSessionAnswered((n) => n + 1)
    if (correct) setSessionCorrect((n) => n + 1)
    setAnsweredWordIds((list) => [...list, item.wordId])
  }

  const requeue = (item: QueueItem): Step[] => {
    const at = Math.min(idx + 3, steps.length)
    const next: Step[] = [...steps.slice(0, at), { kind: 'card', item: { ...item, firstTry: false } }, ...steps.slice(at)]
    setSteps(next)
    return next
  }

  const soundBonusPossible = () =>
    studyMode === 'mixed' &&
    state.settings.exercises.sound &&
    canSpeakHebrew() &&
    [...new Set(answeredWordIds)].length >= 3

  const enterBonusOrSummary = (after: 'steps' | 'match-bonus') => {
    if (after === 'steps' && studyMode === 'mixed' && state.settings.exercises.match) {
      const pool = [...new Set(answeredWordIds)]
      if (pool.length >= 5) {
        const chosen = pool.sort(() => rng() - 0.5).slice(0, 5).map((id) => wordById.get(id)!)
        setBonusMatch(makeMatch(chosen, rng))
        setMatchSel(null)
        setMatchDone([])
        setPhase('match-bonus')
        return
      }
    }
    if (soundBonusPossible()) {
      const pool = [...new Set(answeredWordIds)]
      const chosen = pool.sort(() => rng() - 0.5).slice(0, SOUND_QUESTIONS).map((id) => wordById.get(id)!)
      setSoundQs(chosen.map((w) => makeSoundMatch(w, words, rng)))
      setSoundIdx(0)
      setSoundPicked(null)
      setPhase('sound-bonus')
      return
    }
    setPhase('summary')
  }

  const advance = (currentSteps: Step[]) => {
    const next = idx + 1
    if (next >= currentSteps.length) {
      enterBonusOrSummary('steps')
      return
    }
    setIdx(next)
  }

  const answerCard = (i: number) => {
    touch()
    if (picked !== null || hintWord || !ex || ex.kind === 'flash') return
    const step = steps[idx]
    if (step.kind !== 'card') return
    setPicked(i)
    const correct = i === ex.correctIndex
    dispatchAnswer(step.item, correct, ex.kind === 'blank' ? 'blank' : ex.kind === 'sound' ? 'sound' : 'choice')
    const word = wordById.get(step.item.wordId)
    if (word && ex.kind === 'choice' && !ex.audioOnly && canSpeakHebrew()) speakHebrew(word.hebrew)
    const nextSteps = correct ? steps : requeue(step.item)
    window.setTimeout(() => advance(nextSteps), correct ? 650 : 1500)
  }

  const answerFlash = (knew: boolean) => {
    touch()
    const step = steps[idx]
    if (step.kind !== 'card' || !ex || ex.kind !== 'flash') return
    dispatchAnswer(step.item, knew, 'choice')
    const nextSteps = knew ? steps : requeue(step.item)
    advance(nextSteps)
  }

  const showHint = () => {
    touch()
    const step = steps[idx]
    if (step.kind !== 'card' || picked !== null || hintWord) return
    const word = wordById.get(step.item.wordId)!
    setHintWord(word)
    if (canSpeakHebrew()) speakHebrew(word.hebrew)
    dispatchAnswer(step.item, false, 'choice')
    requeue(step.item)
  }

  // matching-mode group interactions: each completed pair is an SRS answer
  const clickGroupMatch = (side: 'l' | 'r', pair: number) => {
    touch()
    if (!groupEx || matchDone.includes(pair)) return
    if (!matchSel || matchSel.side === side) {
      setMatchSel({ side, pair })
      return
    }
    if (matchSel.pair === pair) {
      setMatchDone((d) => [...d, pair])
      setMatchSel(null)
      const step = steps[idx]
      if (step.kind === 'group') {
        const wordId = groupEx.pairs[pair].wordId
        const item = step.items.find((i) => i.wordId === wordId)
        if (item) dispatchAnswer(item, !mismatched.current.has(wordId), 'choice')
      }
      if (matchDone.length + 1 === groupEx.pairs.length) {
        window.setTimeout(() => advance(steps), 600)
      }
    } else {
      // both words involved in the mismatch are marked as misses
      mismatched.current.add(groupEx.pairs[pair].wordId)
      mismatched.current.add(groupEx.pairs[matchSel.pair].wordId)
      setMatchFlash(pair)
      window.setTimeout(() => setMatchFlash(null), 400)
      setMatchSel(null)
    }
  }

  // bonus rounds (mixed mode)
  const clickBonusMatch = (side: 'l' | 'r', pair: number) => {
    touch()
    if (!bonusMatch || matchDone.includes(pair)) return
    if (!matchSel || matchSel.side === side) {
      setMatchSel({ side, pair })
      return
    }
    if (matchSel.pair === pair) {
      setMatchDone((d) => [...d, pair])
      setMatchSel(null)
      if (matchDone.length + 1 === bonusMatch.pairs.length) {
        window.setTimeout(() => enterBonusOrSummary('match-bonus'), 600)
      }
    } else {
      setMatchFlash(pair)
      window.setTimeout(() => setMatchFlash(null), 400)
      setMatchSel(null)
    }
  }

  useEffect(() => {
    if (phase === 'sound-bonus' && soundQs[soundIdx]) speakHebrew(soundQs[soundIdx].hebrew)
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

  const WordInfo = ({ word }: { word: Word }) => {
    const tr = TRANSLIT[word.id]
    return (
      <div className="hint-panel">
        <div className="prompt he">
          {word.hebrew} <SpeakButton text={word.hebrew} />
        </div>
        {tr && <div className="translit">{tr.he}</div>}
        {(word.gender || word.plural) && (
          <div className="sub">
            {word.gender === 'm' && 'masculine (ז׳)'}
            {word.gender === 'f' && 'feminine (נ׳)'}
            {word.plural && (
              <>
                {' '}· plural: <span className="he">{word.plural}</span>
                {tr?.plural && <> ({tr.plural})</>}
              </>
            )}
          </div>
        )}
        <div className="prompt small">{word.translation}</div>
        <div className="sub">{word.category}</div>
      </div>
    )
  }

  // ---------- render ----------

  if (phase === 'empty') {
    const started = new Set(state.reviews.map((r) => r.wordId))
    const scope = topic ? words.filter((w) => w.category === topic) : words
    const unstartedLeft = scope.filter((w) => !started.has(w.id)).length
    const startedInScope = scope.filter((w) => started.has(w.id)).length
    return (
      <div className="panel card">
        <p className="prompt small">Daily plan for {topic ? `“${topic}”` : 'today'} is done ✅</p>
        <p className="muted">
          The daily new-word pace ({state.settings.newWordsPerDay}/day, adjustable in Settings) is
          used up and nothing is due for review. But nobody is stopping you:
        </p>
        <div className="row-gap" style={{ justifyContent: 'center' }}>
          {unstartedLeft > 0 && (
            <button className="primary" onClick={onMoreNew}>
              ➕ Learn more new words ({unstartedLeft} left{topic ? ' here' : ''})
            </button>
          )}
          {startedInScope > 0 && (
            <button className="ghost" onClick={onPractice}>
              🏋️ Extra practice (weakest words)
            </button>
          )}
          <button className="ghost" onClick={onExit}>Back</button>
        </div>
      </div>
    )
  }

  if (phase === 'match-bonus' && bonusMatch) {
    return (
      <div className="panel card">
        <span className="badge">🎁 Bonus round: match the pairs</span>
        <div className="match-cols" style={{ marginTop: 16 }}>
          <div className="col">
            {bonusMatch.leftOrder.map((p) => (
              <button
                key={`l${p}`}
                className={`he ${matchSel?.side === 'l' && matchSel.pair === p ? 'sel' : ''} ${matchDone.includes(p) ? 'done' : ''} ${matchFlash === p ? 'flash' : ''}`}
                onClick={() => clickBonusMatch('l', p)}
              >
                {bonusMatch.pairs[p].hebrew}
              </button>
            ))}
          </div>
          <div className="col">
            {bonusMatch.rightOrder.map((p) => (
              <button
                key={`r${p}`}
                className={`${matchSel?.side === 'r' && matchSel.pair === p ? 'sel' : ''} ${matchDone.includes(p) ? 'done' : ''} ${matchFlash === p ? 'flash' : ''}`}
                onClick={() => clickBonusMatch('r', p)}
              >
                {bonusMatch.pairs[p].translation}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'sound-bonus' && soundQs[soundIdx]) {
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

  // steps phase
  const step = steps[idx]
  if (!step) return null

  const header = (
    <div className="progress">
      <span>
        {mode === 'practice' ? '🏋️ Practice · ' : ''}
        {MODE_LABEL[studyMode]}
        {topic ? ` · ${topic}` : ''} · {Math.min(idx + 1, steps.length)}/{steps.length}
      </span>
      <button className="ghost" onClick={onExit} style={{ fontSize: 12, padding: '4px 10px' }}>
        End session
      </button>
    </div>
  )

  if (step.kind === 'group' && groupEx) {
    return (
      <>
        {header}
        <div className="panel card">
          <span className="badge">🧩 Match the pairs</span>
          <div className="match-cols" style={{ marginTop: 16 }}>
            <div className="col">
              {groupEx.leftOrder.map((p) => (
                <button
                  key={`l${p}`}
                  className={`he ${matchSel?.side === 'l' && matchSel.pair === p ? 'sel' : ''} ${matchDone.includes(p) ? 'done' : ''} ${matchFlash === p ? 'flash' : ''}`}
                  onClick={() => clickGroupMatch('l', p)}
                >
                  {groupEx.pairs[p].hebrew}
                </button>
              ))}
            </div>
            <div className="col">
              {groupEx.rightOrder.map((p) => (
                <button
                  key={`r${p}`}
                  className={`${matchSel?.side === 'r' && matchSel.pair === p ? 'sel' : ''} ${matchDone.includes(p) ? 'done' : ''} ${matchFlash === p ? 'flash' : ''}`}
                  onClick={() => clickGroupMatch('r', p)}
                >
                  {groupEx.pairs[p].translation}
                </button>
              ))}
            </div>
          </div>
        </div>
      </>
    )
  }

  if (!ex || step.kind !== 'card') return header
  const newChip = isNewWord(step.item.wordId) && <span className="badge new">✨ new</span>

  if (hintWord) {
    return (
      <>
        {header}
        <div className="panel card newword">
          <span className="badge">🛈 Here it is — it will come back soon</span>
          <WordInfo word={hintWord} />
          <button className="primary" onClick={() => { touch(); advance(steps) }}>
            Continue →
          </button>
        </div>
      </>
    )
  }

  const hintButton = picked === null && (
    <button className="hint-btn" onClick={showHint}>
      🛈 Don't know this word
    </button>
  )

  if (ex.kind === 'flash') {
    const front = ex.direction === 'recognition' ? (
      <div className="prompt he">
        {ex.word.hebrew} <SpeakButton text={ex.word.hebrew} />
      </div>
    ) : (
      <div className="prompt small">{ex.word.translation}</div>
    )
    return (
      <>
        {header}
        <div className="panel card">
          {newChip}
          {front}
          {!revealed ? (
            <button className="primary" onClick={() => { touch(); setRevealed(true); if (ex.direction === 'recall' && canSpeakHebrew()) speakHebrew(ex.word.hebrew) }}>
              Show answer
            </button>
          ) : (
            <>
              <WordInfo word={ex.word} />
              <div className="row-gap" style={{ justifyContent: 'center', marginTop: 14 }}>
                <button className="ghost knew" onClick={() => answerFlash(true)}>✓ I knew it</button>
                <button className="ghost missed" onClick={() => answerFlash(false)}>✗ Didn't know</button>
              </div>
            </>
          )}
        </div>
      </>
    )
  }

  if (ex.kind === 'sound') {
    return (
      <>
        {header}
        <div className="panel card">
          {newChip}
          <div style={{ margin: '18px 0' }}>
            <button className="primary" onClick={() => { touch(); speakHebrew(ex.hebrew) }}>
              🔊 Play again
            </button>
          </div>
          <div className="options sound-options">
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
          {hintButton}
        </div>
      </>
    )
  }

  if (ex.kind === 'choice') {
    return (
      <>
        {header}
        <div className="panel card">
          {newChip}
          {ex.audioOnly ? (
            <div style={{ margin: '18px 0' }}>
              <button className="primary" onClick={() => { touch(); speakHebrew(wordById.get(ex.wordId)!.hebrew) }}>
                🔊 Play again
              </button>
              <div className="sub" style={{ marginTop: 8 }}>What did you hear?</div>
            </div>
          ) : (
            <>
              <div className={`prompt ${ex.direction === 'recognition' ? 'he' : 'small'}`}>
                {ex.prompt} {ex.direction === 'recognition' && <SpeakButton text={ex.prompt} />}
              </div>
              <div className="sub">{ex.direction === 'recognition' ? 'What does it mean?' : 'Pick the Hebrew word'}</div>
            </>
          )}
          <div className={`options ${ex.audioOnly ? 'sound-options' : ''}`}>
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
          {hintButton}
        </div>
      </>
    )
  }

  // blank
  return (
    <>
      {header}
      <div className="panel card">
        {newChip}
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
        {hintButton}
      </div>
    </>
  )
}
