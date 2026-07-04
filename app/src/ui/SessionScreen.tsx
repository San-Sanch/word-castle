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
  makeSentenceChoice,
  mulberry32,
  shuffle,
  pickExerciseKind,
  type ChoiceExercise,
  type BlankExercise,
  type MatchExercise,
  type SoundExercise,
  type SentenceChoiceExercise,
} from '../lib/exercises'
import { generateCrossword, type Crossword } from '../lib/crossword'
import { todayISO } from '../lib/time'
import { canSpeakHebrew, speakHebrew } from '../lib/speech'
import translitJson from '../data/translit.json'
import storiesJson from '../data/stories.json'

const TRANSLIT = translitJson as Record<string, { he: string; plural?: string }>

export interface Story {
  id: string
  title_he: string
  title_en: string
  sentences: Array<{ he: string; en: string }>
  questions: Array<{ he: string; en: string; options: string[]; correct: number }>
}
const STORIES = storiesJson as Story[]

interface QueueItem {
  wordId: string
  direction: Direction
  firstTry: boolean
  /** filler rep outside the schedule: counts as effort, does not touch SRS */
  practice?: boolean
}

const MATCH_GROUP = 10
const MEMORY_WORDS = 4 // 8 cards
const CROSSWORD_WORDS = 7

type Step =
  | { kind: 'card'; item: QueueItem }
  | { kind: 'group'; items: QueueItem[] }
  | { kind: 'sent'; sentence: Sentence }
  | { kind: 'crossword'; items: QueueItem[]; puzzle: Crossword }
  | { kind: 'memory'; items: QueueItem[] }
  | { kind: 'build'; sentence: Sentence }
  | { kind: 'story-read'; story: Story }
  | { kind: 'story-q'; story: Story; qIdx: number }

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
  sentences: '💬 Sentences',
  blanks: '📝 Missing word',
  crossword: '🔠 Crossword',
  memory: '🎴 Memory',
  builder: '🏗️ Builder',
  story: '📚 Story',
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
  const reverse = state.settings.reverse
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
    const grouped = (size: number, kind: 'group' | 'memory' | 'crossword'): Step[] => {
      const steps: Step[] = []
      let group: QueueItem[] = []
      const leftovers: QueueItem[] = []
      for (const item of queue) {
        const word = wordById.get(item.wordId)!
        if (
          group.some((g) => g.wordId === item.wordId) ||
          (kind === 'crossword' && (word.hebrew.includes(' ') || [...word.hebrew].length < 2))
        ) {
          leftovers.push(item)
          continue
        }
        group.push(item)
        if (group.length === size) {
          steps.push(makeGroupStep(kind, group))
          group = []
        }
      }
      const rest = [...group]
      if (rest.length >= 3) steps.push(makeGroupStep(kind, rest))
      else for (const item of rest) steps.push({ kind: 'card', item })
      for (const item of leftovers) steps.push({ kind: 'card', item })
      return steps
    }
    const makeGroupStep = (kind: 'group' | 'memory' | 'crossword', items: QueueItem[]): Step => {
      if (kind === 'crossword') {
        const puzzle = generateCrossword(items.map((i) => wordById.get(i.wordId)!), rng, items.length)
        const placedIds = new Set(puzzle.placements.map((p) => p.wordId))
        // words the generator could not place become plain cards later
        const placedItems = items.filter((i) => placedIds.has(i.wordId))
        return { kind: 'crossword', items: placedItems, puzzle }
      }
      return kind === 'memory' ? { kind: 'memory', items } : { kind: 'group', items }
    }
    if (studyMode === 'matching') return grouped(MATCH_GROUP, 'group')
    if (studyMode === 'memory') return grouped(MEMORY_WORDS, 'memory')
    if (studyMode === 'crossword') return grouped(CROSSWORD_WORDS, 'crossword')
    return queue.map((item) => ({ kind: 'card', item }))
  }

  /** Sessions are never 2 cards long: pad with weakest-word practice reps. */
  const padQueue = (queue: QueueItem[], eligible: (wordId: string) => boolean): QueueItem[] => {
    if (queue.length >= state.settings.sessionSize) return queue.slice(0, state.settings.sessionSize)
    const used = new Set(queue.map((q) => `${q.wordId}|${q.direction}`))
    const fill: QueueItem[] = state.reviews
      .filter((r) => eligible(r.wordId) && !used.has(`${r.wordId}|${r.direction}`))
      .sort((a, b) => (a.box === b.box ? (a.dueAt < b.dueAt ? -1 : 1) : a.box - b.box))
      .slice(0, state.settings.sessionSize - queue.length)
      .map((r) => ({ wordId: r.wordId, direction: r.direction, firstTry: true, practice: true }))
    return [...queue, ...shuffle(fill, rng)]
  }

  const [steps, setSteps] = useState<Step[]>(() => {
    const inTopic = topic ? new Set(words.filter((w) => w.category === topic).map((w) => w.id)) : null
    const topicOk = (id: string) => !inTopic || inTopic.has(id)

    if (studyMode === 'sentences') {
      // whole sentences: see one language, pick the other among 8
      const pool = shuffle(sentences, rng).slice(0, state.settings.sessionSize)
      return pool.map((sentence) => ({ kind: 'sent', sentence }))
    }

    if (studyMode === 'builder') {
      // arrange word tiles into your real sentences (3-10 clean tokens)
      const buildable = sentences.filter(
        (s) => s.tokens.length >= 3 && s.tokens.length <= 10 && !s.hebrew.includes('/'),
      )
      const pool = shuffle(buildable, rng).slice(0, Math.min(state.settings.sessionSize, 12))
      return pool.map((sentence) => ({ kind: 'build', sentence }))
    }

    if (studyMode === 'story') {
      // next unfinished story, otherwise a random reread
      const story =
        STORIES.find((s) => (state.storyScores[s.id] ?? -1) < s.questions.length) ??
        STORIES[Math.floor(rng() * STORIES.length)]
      return [
        { kind: 'story-read', story },
        ...story.questions.map((_, qIdx) => ({ kind: 'story-q' as const, story, qIdx })),
      ]
    }

    const needsSentence = studyMode === 'blanks'
    const eligible = (id: string) => topicOk(id) && (!needsSentence || sentencesByWord.has(id))

    if (mode === 'practice') {
      const queue = state.reviews
        .filter((r) => eligible(r.wordId))
        .sort((a, b) => (a.box === b.box ? (a.dueAt < b.dueAt ? -1 : 1) : a.box - b.box))
        .slice(0, state.settings.sessionSize)
        .map((s) => ({ wordId: s.wordId, direction: s.direction, firstTry: true }))
      return buildSteps(queue)
    }

    const plan = buildSessionPlan({
      words: needsSentence ? words.filter((w) => sentencesByWord.has(w.id)) : words,
      states: needsSentence ? state.reviews.filter((r) => sentencesByWord.has(r.wordId)) : state.reviews,
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
    const queue = padQueue(shuffle([...due, ...fresh], rng), eligible)
    return buildSteps(queue)
  })

  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>(steps.length === 0 ? 'empty' : 'steps')
  const [ex, setEx] = useState<CurrentEx | null>(null)
  const [sentEx, setSentEx] = useState<SentenceChoiceExercise | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [hintWord, setHintWord] = useState<Word | null>(null)
  const [sessionAnswered, setSessionAnswered] = useState(0)
  const [sessionCorrect, setSessionCorrect] = useState(0)
  const [answeredWordIds, setAnsweredWordIds] = useState<string[]>([])
  const masteredAtStart = useRef(todayLog(state, today).graduated)

  // --- match group state ---
  const [groupEx, setGroupEx] = useState<MatchExercise | null>(null)
  const [matchSel, setMatchSel] = useState<{ side: 'l' | 'r'; pair: number } | null>(null)
  const [matchDone, setMatchDone] = useState<number[]>([])
  const [matchFlash, setMatchFlash] = useState<number | null>(null)
  const mismatched = useRef(new Set<string>())

  // --- crossword state ---
  const [cwActive, setCwActive] = useState<string | null>(null) // wordId of the active clue
  const [cwSolved, setCwSolved] = useState<string[]>([])
  const [cwOptions, setCwOptions] = useState<string[]>([])
  const [cwCorrect, setCwCorrect] = useState('')
  const [cwPicked, setCwPicked] = useState<string | null>(null)
  const cwDispatched = useRef(new Set<string>())

  // --- memory state ---
  interface MemoryCard { id: number; wordId: string; text: string; he: boolean }
  const [memCards, setMemCards] = useState<MemoryCard[]>([])
  const [memOpen, setMemOpen] = useState<number[]>([])
  const [memSolved, setMemSolved] = useState<string[]>([])
  const memMissed = useRef(new Set<string>())

  // --- sentence builder state ---
  interface Tile { id: number; text: string; used: boolean }
  const [buildTiles, setBuildTiles] = useState<Tile[]>([])
  const [buildProgress, setBuildProgress] = useState(0)
  const [buildTokens, setBuildTokens] = useState<string[]>([])
  const [buildFlash, setBuildFlash] = useState<number | null>(null)
  const buildMissed = useRef(false)

  // --- story state ---
  const [revealedSentences, setRevealedSentences] = useState<number[]>([])
  const storyCorrect = useRef(0)

  // --- end-of-session bonus (mixed only) ---
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

  const effDirection = (d: Direction): Direction =>
    reverse ? (d === 'recognition' ? 'recall' : 'recognition') : d

  const genExercise = (item: QueueItem): CurrentEx => {
    const word = wordById.get(item.wordId)!
    const dir = effDirection(item.direction)
    if (studyMode === 'flashcards') return { kind: 'flash', word, direction: dir }
    if (studyMode === 'listening') {
      if (dir === 'recall') return makeSoundMatch(word, words, rng)
      return { ...makeChoice(word, 'recognition', words, rng, 8), audioOnly: true }
    }
    const review = state.reviews.find((r) => r.wordId === item.wordId && r.direction === item.direction)
    const box = review?.box ?? 0
    const withSentence = sentencesByWord.get(item.wordId) ?? []
    if (studyMode === 'blanks' && withSentence.length > 0) {
      const pick = withSentence[Math.floor(rng() * withSentence.length)]
      return makeBlank(pick.sentence, { tokenIndex: pick.tokenIndex, wordId: item.wordId }, words, rng)
    }
    if (studyMode === 'random') {
      const kinds: Array<'choice' | 'audio-choice' | 'blank' | 'sound' | 'flash'> = ['choice', 'flash']
      if (withSentence.length > 0) kinds.push('blank')
      if (canSpeakHebrew()) kinds.push('sound', 'audio-choice')
      const kind = kinds[Math.floor(rng() * kinds.length)]
      if (kind === 'flash') return { kind: 'flash', word, direction: dir }
      if (kind === 'sound') return makeSoundMatch(word, words, rng)
      if (kind === 'audio-choice') return { ...makeChoice(word, 'recognition', words, rng, 8), audioOnly: true }
      if (kind === 'blank') {
        const pick = withSentence[Math.floor(rng() * withSentence.length)]
        return makeBlank(pick.sentence, { tokenIndex: pick.tokenIndex, wordId: item.wordId }, words, rng)
      }
      return makeChoice(word, dir, words, rng)
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
    return makeChoice(word, dir, words, rng)
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
    } else if (currentStep.kind === 'sent') {
      setSentEx(makeSentenceChoice(currentStep.sentence, sentences, rng, reverse))
    } else if (currentStep.kind === 'group') {
      for (const item of currentStep.items) ensureIntroduced(item.wordId)
      mismatched.current = new Set()
      setMatchSel(null)
      setMatchDone([])
      setGroupEx(makeMatch(currentStep.items.map((i) => wordById.get(i.wordId)!), rng))
    } else if (currentStep.kind === 'crossword') {
      for (const item of currentStep.items) ensureIntroduced(item.wordId)
      cwDispatched.current = new Set()
      setCwSolved([])
      setCwPicked(null)
      setCwActive(null)
      setCwOptions([])
    } else if (currentStep.kind === 'build') {
      const toks = reverse
        ? currentStep.sentence.translation.replace(/[.?!]/g, '').split(/\s+/).filter(Boolean)
        : currentStep.sentence.tokens
      setBuildTokens(toks)
      setBuildTiles(shuffle(toks.map((text, i) => ({ id: i, text, used: false })), rng))
      setBuildProgress(0)
      buildMissed.current = false
      if (!reverse && canSpeakHebrew()) speakHebrew(currentStep.sentence.hebrew)
    } else if (currentStep.kind === 'story-read') {
      setRevealedSentences([])
      if (idx === 0) storyCorrect.current = 0
    } else if (currentStep.kind === 'memory') {
      for (const item of currentStep.items) ensureIntroduced(item.wordId)
      memMissed.current = new Set()
      setMemSolved([])
      setMemOpen([])
      const cards: MemoryCard[] = shuffle(
        currentStep.items.flatMap((item, i) => {
          const w = wordById.get(item.wordId)!
          return [
            { id: i * 2, wordId: w.id, text: w.hebrew, he: true },
            { id: i * 2 + 1, wordId: w.id, text: w.translation, he: false },
          ]
        }),
        rng,
      )
      setMemCards(cards)
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
    if (mode === 'practice' || item.practice) {
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
      if (pool.length >= MATCH_GROUP) {
        const chosen = pool.sort(() => rng() - 0.5).slice(0, MATCH_GROUP).map((id) => wordById.get(id)!)
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

  const answerSentence = (i: number) => {
    touch()
    if (picked !== null || !sentEx) return
    setPicked(i)
    const correct = i === sentEx.correctIndex
    // sentence recognition is practice: it trains reading, not the word SRS
    dispatch({ type: 'practiceAnswer', correct, today })
    setSessionAnswered((n) => n + 1)
    if (correct) setSessionCorrect((n) => n + 1)
    // hold the slide until the sentence finishes speaking
    const proceed = () => window.setTimeout(() => advance(steps), correct ? 300 : 1200)
    if (canSpeakHebrew()) {
      speakHebrew(sentEx.reverse ? sentEx.prompt : sentEx.options[sentEx.correctIndex], proceed)
    } else {
      window.setTimeout(() => advance(steps), correct ? 900 : 2000)
    }
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
    if (side === 'l') speakHebrew(groupEx.pairs[pair].hebrew)
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
      mismatched.current.add(groupEx.pairs[pair].wordId)
      mismatched.current.add(groupEx.pairs[matchSel.pair].wordId)
      setMatchFlash(pair)
      window.setTimeout(() => setMatchFlash(null), 400)
      setMatchSel(null)
    }
  }

  // bonus match (mixed mode)
  const clickBonusMatch = (side: 'l' | 'r', pair: number) => {
    touch()
    if (!bonusMatch || matchDone.includes(pair)) return
    if (side === 'l') speakHebrew(bonusMatch.pairs[pair].hebrew)
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

  // --- crossword interactions ---
  const openClue = (wordId: string) => {
    touch()
    const step = steps[idx]
    if (step.kind !== 'crossword' || cwSolved.includes(wordId)) return
    const word = wordById.get(wordId)!
    setCwActive(wordId)
    setCwPicked(null)
    const choice = makeChoice(word, reverse ? 'recognition' : 'recall', words, rng, 8)
    setCwOptions(choice.options)
    setCwCorrect(choice.options[choice.correctIndex])
    if (reverse && canSpeakHebrew()) speakHebrew(word.hebrew)
  }

  const answerCrossword = (option: string) => {
    touch()
    const step = steps[idx]
    if (step.kind !== 'crossword' || !cwActive) return
    const correct = option === cwCorrect
    setCwPicked(option)
    if (!cwDispatched.current.has(cwActive)) {
      cwDispatched.current.add(cwActive)
      const item = step.items.find((i) => i.wordId === cwActive)
      if (item) dispatchAnswer(item, correct, 'choice')
    }
    if (correct) {
      const word = wordById.get(cwActive)!
      if (canSpeakHebrew()) speakHebrew(word.hebrew)
      const solved = [...cwSolved, cwActive]
      window.setTimeout(() => {
        setCwSolved(solved)
        setCwActive(null)
        setCwPicked(null)
        if (solved.length === step.puzzle.placements.length) {
          window.setTimeout(() => advance(steps), 700)
        }
      }, 500)
    } else {
      window.setTimeout(() => setCwPicked(null), 600) // try again
    }
  }

  // --- sentence builder interactions ---
  const clickTile = (tileIdx: number) => {
    touch()
    const step = steps[idx]
    if (step.kind !== 'build') return
    const tile = buildTiles[tileIdx]
    if (!tile || tile.used) return
    const expected = buildTokens[buildProgress]
    if (tile.text === expected) {
      setBuildTiles((ts) => ts.map((t, i) => (i === tileIdx ? { ...t, used: true } : t)))
      const next = buildProgress + 1
      setBuildProgress(next)
      if (next === buildTokens.length) {
        dispatch({ type: 'practiceAnswer', correct: !buildMissed.current, today })
        setSessionAnswered((n) => n + 1)
        if (!buildMissed.current) setSessionCorrect((n) => n + 1)
        // wait for the full sentence to finish speaking before moving on
        if (canSpeakHebrew()) {
          speakHebrew(step.sentence.hebrew, () => window.setTimeout(() => advance(steps), 350))
        } else {
          window.setTimeout(() => advance(steps), 1200)
        }
      }
    } else {
      buildMissed.current = true
      setBuildFlash(tileIdx)
      window.setTimeout(() => setBuildFlash(null), 400)
    }
  }

  // --- story interactions ---
  const answerStoryQuestion = (i: number) => {
    touch()
    const step = steps[idx]
    if (step.kind !== 'story-q' || picked !== null) return
    setPicked(i)
    const q = step.story.questions[step.qIdx]
    const correct = i === q.correct
    if (correct) storyCorrect.current += 1
    dispatch({ type: 'practiceAnswer', correct, today })
    setSessionAnswered((n) => n + 1)
    if (correct) setSessionCorrect((n) => n + 1)
    if (canSpeakHebrew()) speakHebrew(q.options[q.correct])
    const last = step.qIdx === step.story.questions.length - 1
    if (last) dispatch({ type: 'storyResult', storyId: step.story.id, correct: storyCorrect.current })
    window.setTimeout(() => advance(steps), correct ? 900 : 2000)
  }

  // --- memory interactions ---
  const flipMemory = (cardIdx: number) => {
    touch()
    const step = steps[idx]
    if (step.kind !== 'memory') return
    const card = memCards[cardIdx]
    if (!card || memSolved.includes(card.wordId) || memOpen.includes(cardIdx) || memOpen.length >= 2) return
    if (card.he) speakHebrew(card.text)
    const open = [...memOpen, cardIdx]
    setMemOpen(open)
    if (open.length < 2) return
    const [a, b] = open.map((i) => memCards[i])
    if (a.wordId === b.wordId) {
      const solved = [...memSolved, a.wordId]
      window.setTimeout(() => {
        setMemSolved(solved)
        setMemOpen([])
        const item = step.items.find((i) => i.wordId === a.wordId)
        if (item) dispatchAnswer(item, !memMissed.current.has(a.wordId), 'choice')
        if (solved.length === step.items.length) {
          window.setTimeout(() => advance(steps), 700)
        }
      }, 500)
    } else {
      memMissed.current.add(a.wordId)
      memMissed.current.add(b.wordId)
      window.setTimeout(() => setMemOpen([]), 900)
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

  /** Compact post-answer reveal for audio exercises: word + transcription + meaning. */
  const AnswerReveal = ({ wordId }: { wordId: string }) => {
    const word = wordById.get(wordId)
    if (!word) return null
    const tr = TRANSLIT[word.id]
    return (
      <div className="answer-reveal">
        <span className="he">{word.hebrew}</span>
        {tr && <span className="translit"> {tr.he}</span>}
        <span> — {word.translation}</span>
      </div>
    )
  }

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

  const header = (
    <div className="progress">
      <span>
        {mode === 'practice' ? '🏋️ Practice · ' : ''}
        {MODE_LABEL[studyMode]}
        {reverse ? ' ↔' : ''}
        {topic ? ` · ${topic}` : ''} · {Math.min(idx + 1, steps.length)}/{steps.length}
      </span>
      <button className="ghost" onClick={onExit} style={{ fontSize: 12, padding: '4px 10px' }}>
        End session
      </button>
    </div>
  )

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
        {soundPicked !== null && <AnswerReveal wordId={q.wordId} />}
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

  if (step.kind === 'sent' && sentEx) {
    return (
      <>
        {header}
        <div className="panel card">
          <div className={`prompt small ${sentEx.reverse ? 'he' : ''}`}>
            {sentEx.prompt} {sentEx.reverse && <SpeakButton text={sentEx.prompt} />}
          </div>
          <div className="sub">{sentEx.reverse ? 'Pick the translation' : 'Pick the Hebrew sentence'}</div>
          <div className="options sentence-options">
            {sentEx.options.map((o, i) => (
              <button
                key={i}
                className={`${sentEx.reverse ? '' : 'he'} ${picked !== null && i === sentEx.correctIndex ? 'correct' : picked === i ? 'wrong' : ''}`}
                disabled={picked !== null}
                onClick={() => answerSentence(i)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      </>
    )
  }

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

  if (step.kind === 'crossword') {
    const { puzzle } = step
    const cellMap = new Map<string, { letter: string; wordIds: string[]; num?: number }>()
    for (const p of puzzle.placements) {
      p.letters.forEach((letter, i) => {
        const r = p.dir === 'h' ? p.row : p.row + i
        const c = p.dir === 'h' ? p.col + i : p.col
        const key = `${r},${c}`
        const cell = cellMap.get(key) ?? { letter, wordIds: [] }
        cell.wordIds.push(p.wordId)
        if (i === 0 && cell.num === undefined) cell.num = p.num
        cellMap.set(key, cell)
      })
    }
    const activeWord = cwActive ? wordById.get(cwActive) : null
    return (
      <>
        {header}
        <div className="panel card">
          <span className="badge">🔠 Crossword: solve every word</span>
          <div className="cw-grid-wrap" dir="rtl">
            <table className="cw-grid">
              <tbody>
                {Array.from({ length: puzzle.rows }, (_, r) => (
                  <tr key={r}>
                    {Array.from({ length: puzzle.cols }, (_, c) => {
                      const cell = cellMap.get(`${r},${c}`)
                      if (!cell) return <td key={c} className="cw-void" />
                      const solved = cell.wordIds.some((id) => cwSolved.includes(id))
                      const active = cwActive && cell.wordIds.includes(cwActive)
                      return (
                        <td
                          key={c}
                          className={`cw-cell ${solved ? 'solved' : ''} ${active ? 'active' : ''}`}
                          onClick={() => openClue(cell.wordIds.find((id) => !cwSolved.includes(id)) ?? cell.wordIds[0])}
                        >
                          <span className="cw-num">{cell.num ?? ''}</span>
                          <span className="cw-letter he">{solved ? cell.letter : ''}</span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cw-clues">
            {puzzle.placements.map((p) => {
              const w = wordById.get(p.wordId)!
              const solved = cwSolved.includes(p.wordId)
              return (
                <button
                  key={p.wordId}
                  className={`cw-clue ${solved ? 'done' : ''} ${cwActive === p.wordId ? 'sel' : ''}`}
                  onClick={() => openClue(p.wordId)}
                  disabled={solved}
                >
                  {p.num}. {p.dir === 'h' ? '→' : '↓'}{' '}
                  {reverse ? <span className="he">{w.hebrew}</span> : w.translation}
                  {solved && ' ✓'}
                </button>
              )
            })}
          </div>
          {activeWord && (
            <div className="cw-answers">
              <div className="sub">
                {reverse
                  ? <>Meaning of <b className="he">{activeWord.hebrew}</b>?</>
                  : <>Which word is “{activeWord.translation}”?</>}
              </div>
              <div className="options sound-options">
                {cwOptions.map((o) => (
                  <button
                    key={o}
                    className={`${reverse ? '' : 'he'} ${cwPicked === o ? (o === cwCorrect ? 'correct' : 'wrong') : ''}`}
                    onClick={() => answerCrossword(o)}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    )
  }

  if (step.kind === 'build') {
    const done = buildProgress === buildTokens.length && buildTokens.length > 0
    return (
      <>
        {header}
        <div className="panel card">
          <span className="badge">🏗️ Build the sentence</span>
          <div className={`prompt small ${reverse ? 'he' : ''}`} style={{ marginTop: 10 }}>
            {reverse ? step.sentence.hebrew : step.sentence.translation}
            {/* hear the target sentence any time */}
            <SpeakButton text={step.sentence.hebrew} />
          </div>
          <div className={`build-answer ${reverse ? '' : 'he'} ${done ? 'done' : ''}`}>
            {buildTokens.slice(0, buildProgress).map((t, i) => (
              <span key={i} className="build-word">{t}</span>
            ))}
            {!done && <span className="build-cursor">▁</span>}
            {done && !reverse && <SpeakButton text={step.sentence.hebrew} />}
          </div>
          <div className="build-tiles">
            {buildTiles.map((tile, i) => (
              <button
                key={tile.id}
                className={`build-tile ${reverse ? '' : 'he'} ${tile.used ? 'used' : ''} ${buildFlash === i ? 'flash-tile' : ''}`}
                disabled={tile.used || done}
                onClick={() => clickTile(i)}
              >
                {tile.text}
              </button>
            ))}
          </div>
        </div>
      </>
    )
  }

  if (step.kind === 'story-read') {
    return (
      <>
        {header}
        <div className="panel card story-card">
          <div className="prompt he">{step.story.title_he}</div>
          <div className="sub">{step.story.title_en} · tap a line to see its translation</div>
          <div className="story-lines">
            {step.story.sentences.map((s, i) => (
              <div key={i} className="story-line" onClick={() => { touch(); setRevealedSentences((r) => (r.includes(i) ? r.filter((x) => x !== i) : [...r, i])) }}>
                <SpeakButton text={s.he} />
                <div>
                  <div className="he story-he">{s.he}</div>
                  {revealedSentences.includes(i) && <div className="muted">{s.en}</div>}
                </div>
              </div>
            ))}
          </div>
          <button className="primary" style={{ marginTop: 16 }} onClick={() => { touch(); advance(steps) }}>
            To the questions →
          </button>
        </div>
      </>
    )
  }

  if (step.kind === 'story-q') {
    const q = step.story.questions[step.qIdx]
    return (
      <>
        {header}
        <div className="panel card">
          <span className="badge">📚 {step.story.title_he} · question {step.qIdx + 1}/{step.story.questions.length}</span>
          <div className="prompt small he" style={{ marginTop: 12 }}>
            {q.he} <SpeakButton text={q.he} />
          </div>
          <div className="sub">{q.en}</div>
          <div className="options sentence-options">
            {q.options.map((o, i) => (
              <button
                key={i}
                className={`he ${picked !== null && i === q.correct ? 'correct' : picked === i ? 'wrong' : ''}`}
                disabled={picked !== null}
                onClick={() => answerStoryQuestion(i)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      </>
    )
  }

  if (step.kind === 'memory') {
    return (
      <>
        {header}
        <div className="panel card">
          <span className="badge">🎴 Memory: find the pairs</span>
          <div className="memory-grid">
            {memCards.map((card, i) => {
              const open = memOpen.includes(i) || memSolved.includes(card.wordId)
              return (
                <button
                  key={card.id}
                  className={`memory-card ${open ? 'open' : ''} ${memSolved.includes(card.wordId) ? 'done' : ''} ${card.he ? 'he' : ''}`}
                  onClick={() => flipMemory(i)}
                >
                  {open ? card.text : '?'}
                </button>
              )
            })}
          </div>
        </div>
      </>
    )
  }

  if (step.kind !== 'card' || !ex) return header
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
          {picked !== null && <AnswerReveal wordId={ex.wordId} />}
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
          {picked !== null && ex.audioOnly && <AnswerReveal wordId={ex.wordId} />}
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
          {/* before answering: speak the sentence with a pause at the gap; after: the full sentence */}
          <SpeakButton
            text={ex.tokens
              .map((t, i) => (i === ex.blankIndex ? (picked !== null ? ex.options[ex.correctIndex] : ',') : t))
              .join(' ')}
          />
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
