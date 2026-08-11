# Word Castle: Hebrew Vocabulary Trainer

> **PIVOT (2026-07-04, section 15):** the game layer (castle, world, camps, economy) is
> shelved by Sanch's decision — the app is now a focused learning system. Sections 1-14
> describe the shelved game and remain valid history; the game code lives in git
> (tags/commits up to `a5e1685`) and its engines remain in `src/lib` if ever revived.

# Original spec: Hebrew Vocabulary Game (MVP)

Working title: **Word Castle** (מבצר המילים). Rename anytime.

## 1. Goal

Expand Hebrew vocabulary through a daily habit (target: ~1 hour/day) that stays fun. Learning and reviewing words earns coins; coins and "bricks" (learned words) build a castle; guardians defend it; attacks create loss pressure that keeps the streak alive.

Focus: speaking/reading vocabulary. No spelling or writing exercises in this phase.

## 2. Stack

- React + Vite + TypeScript, single-page web app.
- Runs locally (`npm run dev` or built static files). No backend, no accounts.
- All state in browser IndexedDB (Dexie.js). JSON export/import button for backup.
- Storage isolated in one module (`storage/`) so Wix Headless can replace it later without touching game logic.
- Word data imported from `hebrew_words.csv` at first launch (bundled with the app).

## 3. Data model

### Word
| Field | Notes |
|---|---|
| id | stable hash of Hebrew text |
| hebrew | base word, e.g. אימא |
| hebrewFull | raw CSV value, e.g. `אימא (נ') אימהות` |
| gender | `m` / `f` / null, parsed from (ז') / (נ') |
| plural | parsed if present |
| ukrainian | translation |
| category | from CSV |

### ReviewState (per word, per direction)
| Field | Notes |
|---|---|
| wordId, direction | direction: `recognition` (He→Ua) or `recall` (Ua→He) |
| box | SRS level 0..7 |
| dueAt | next review date |
| lapses, streak | stats |

### Wallet: `coins`, `bricks` (bricks = count of graduated words available as building material)

### CastleItem: `type`, `position`, `builtAt`, `status` (`built` / `ruin`), `rebuildDiscount`

### Guardian: `name`, `avatar`, `categoryAssigned`, `level` (1..10), `xp`

### SessionLog / AttackLog: per-day stats for streak, goal tracking, attack outcomes

### Settings (all editable in UI)
- newWordsPerDay (default 10)
- dailyGoalMinutes (default 20, measured as active practice time: timer pauses when the tab is hidden or the user is idle for 30+ seconds)
- sessionSize (default 25 cards per session)
- attackChancePerSession (default 15%)
- exercise mix toggles

## 4. SRS engine

Simplified SM-2 / Leitner hybrid:

- Boxes 0..7 with intervals: 0d (same session), 1d, 2d, 4d, 8d, 16d, 32d, 64d.
- Correct: box +1. Mistake: box drops to max(box-2, 0), word re-queued in the same session.
- **Direction mixing:** every word starts in `recognition` (He→Ua). When recognition reaches box 3, the `recall` direction (Ua→He) is activated and starts at box 0. A word is **graduated** (becomes a brick, pays bonus) when recall reaches box 4.
- Session order: due reviews first, then new words (up to daily limit), then optional extra practice (reduced coins).

## 5. Exercises

No typing, no spelling. All answers are selection/arrangement.

| # | Exercise | Description | Coins per correct | Phase |
|---|---|---|---|---|
| 1 | Multiple choice | word shown, pick translation from 4 options (both directions) | 1 | MVP |
| 2 | Fill the blank | sentence with a gap, pick the missing word from 4 options | 2 | MVP |
| 3 | Match columns | 5 Hebrew vs 5 Ukrainian, connect pairs | 2 (per full set: 10) | MVP |
| 4 | Lightning round | 60s rapid multiple choice, combo multiplier x1/x2/x3; also the attack battle mode | 1 x combo | MVP |
| 5 | Odd one out | 4 words, tap the one not in the category | 2 | v1.1 |
| 6 | Gender duel | word shown, pick ז' or נ' (only gendered nouns) | 1 | v1.1 |
| 7 | Memory pairs | flip-card memory grid He/Ua, relaxing bonus mode | 1 per pair | v1.1 |
| 8 | Sentence builder | arrange word tiles into a correct sentence (uses sentences CSV) | 3 | v1.2 |

Exercise type per card is chosen by the engine based on SRS box (low boxes get easier forms), with variety enforced (no more than 3 of the same type in a row).

Mistakes: no coin loss during exercises, the word just returns sooner (box drop + re-queue). Loss pressure lives in the attack system, not in learning.

## 6. Economy

Earning:
- Base coins per correct answer: see table above.
- First-try bonus: +1 if answered correctly on first attempt of the day.
- Daily goal reached (20 min active practice): +25 coins.
- Extra time bonuses: +35 coins at 40 min, +50 coins at 60 min, +50 for every full 20 min after that.
- Word graduated: +10 coins, +1 brick.
- Attack won: loot 20-50 coins.

Spending (initial shop, all prices tunable):
| Item | Coins | Bricks | Effect |
|---|---|---|---|
| Land tile | 50 | 0 | expands buildable area |
| Wall segment | 30 | 5 | +1 defense each, visual perimeter |
| Gate | 100 | 10 | required before towers |
| Tower | 200 | 20 | +3 defense |
| Banner / decor | 40 | 0 | cosmetic |
| Keep (castle heart) | 500 | 50 | end-goal of MVP castle |
| Hire guardian | 150 | 0 | enables defense and upgrades |

Rebuilding a ruin: 50% of the original price, bricks are not charged again.

## 7. Guardian

- One guardian in MVP. Hired in the shop, gets a name and an assigned word category.
- Upgrade = "training set": an extra session of ~20 cards drawn from the guardian's category. Completing it grants guardian XP; level up every N sets (level curve: 1 set for L2, 2 more for L3, etc., up to L10).
- Guardian level is the main defense stat.

## 8. Attacks

Defense score = guardian level + wall bonus (walls +1 each, towers +3).

**In-session attack** (random, default 15% chance per session):
1. Attack banner appears with severity roll 1..10.
2. Battle = lightning round: need `severity * 3 - defense` correct answers in 60s (minimum 5).
3. Win: loot (20-50 coins). Narrow loss: lose 10% of coins (capped at 50). Heavy loss (below half the target): the **latest built upgrade** becomes a ruin.

**Skip-day raid:**
- Missing a full day (no session at all) triggers an overnight raid.
- Coin loss: 10% of wallet, reduced by 1% per guardian level (L10 guardian = fully prevented).
- Two or more consecutive missed days: latest upgrade becomes a ruin (severity grows with days missed vs defense).
- Bricks and graduated words are never lost. Ruins are rebuildable at 50%.

## 9. Screens

1. **Castle (home):** 2D grid plot (simple flat tiles/sprites), coins, bricks, streak, daily goal progress bar, big "Start session" button, attack/raid notices.
2. **Session:** one exercise at a time, progress within session, coin counter animating on earn.
3. **Shop:** items with prices, buy and place on the grid.
4. **Guardian:** character card, level, assigned category, "Train" button starting a training set.
5. **Stats:** words by box, graduated count, daily history, streak calendar.
6. **Settings:** SRS and game parameters, export/import JSON backup, reset.

Visuals: simple and clean, emoji/flat-SVG sprites for MVP. Dark theme, consistent with the songs app style (navy/charcoal, warm gold accent). Hebrew rendered RTL, larger font.

## 10. Data import notes

- `hebrew_words.csv`: 1044 rows, He/Ua/Category/Occurrences. Parser extracts gender markers (ז')/(נ') and plural forms from the Hebrew column. Source CSV is never modified (source data is authoritative).
- `source-data/hebrew_sentences.csv`: sentences have **English** translations, not Ukrainian. Used for fill-the-blank and (later) sentence builder. Open question below.

## 11. Phasing

- **MVP:** import, SRS engine, exercises 1-4, economy, shop + castle grid, one guardian, both attack types, all 6 screens, backup.
- **v1.1:** exercises 5-7, more shop items, second guardian.
- **v1.2:** sentence builder, phrase blocks (phrase = block material), trading.
- **Later:** Wix Headless (accounts, shared storage), teammates, audio/TTS, AI-chat guardian.

## 12. Resolved decisions

1. Sentences: English translations used as-is in fill-the-blank.
2. Daily goal: 20 minutes minimum of active practice, extra time gives extra coin bonuses.
3. Name: Word Castle, confirmed.
4. Translations: all English. The 413 Ukrainian CSV entries are overridden app-side via
   `app/src/data/translation-overrides.json`, translated from the Hebrew column
   (this also corrects a one-row translation shift in the Food & Drinks block of the
   source CSV, rows ~72-105; the CSV itself is untouched and still needs fixing).

## 13. Post-MVP additions (2026-07-04, second iteration)

- **Full-width layout**: app uses the whole screen; castle grid + shop side by side on desktop.
- **Nature castle view**: the 8x8 board renders wilderness (trees, rocks, flowers) on
  unclaimed cells; buying a plot clears it for building ("Buy plot" in the shop).
- **Hebrew pronunciation (TTS)**: Web Speech API with a system Hebrew voice. Auto-plays on
  new-word intros and after answering; 🔊 buttons on Hebrew prompts. If no Hebrew voice is
  installed, buttons hide and Settings shows how to add one (macOS: Spoken Content → Carmit).
- **Sound match bonus round**: after the match round, up to 5 questions: hear a word, pick it
  among 6 similar-looking Hebrew words (similarity = shared prefix + bigram overlap + length).
  2 coins per correct, no SRS effect. Toggle in Settings.
- **Profiles**: header dropdown + Settings management. Each profile has its own IndexedDB
  save (`game:<id>`), the pre-profiles save migrates to profile `main`. "Test profile" button
  seeds 100,000 coins + 1,000 bricks for trying building/buying. New player profile starts fresh.
- **Parser**: gender markers now handle the CSV's sloppy variants: (ז), (זי), (ז'(, and the
  combined (ז'/נ') for both-gender nouns.

## 14. The living world (2026-07-04, third iteration)

Decisions by Sanch: world ticks on every answered card; demolition refunds nothing;
food = guardian upkeep and future guardian slots; heavy battle defeats can breach walls.

- **Infinite map**: deterministic procedural terrain (seeded value noise): grassland,
  forests, winding rivers, mountains. The starting area (homeland) is always grass.
  Drag to pan; tiles render only inside the viewport.
- **Fog of war**: you see radius 3 around each building (towers 5, keep 4, roads 2).
  Everything else is darkness, including approaching enemies.
- **World tick**: one per answered exercise card. Producers yield on tick cadence:
  woodcutter +1 wood/15 ticks, quarry +1 stone/18, crop field +1 food/20. Learning is
  literally the world's clock: nothing moves unless Sanch practices Hebrew.
- **Resources**: coins (practice), bricks (graduated words), wood, stone, food.
  Costs are mixes: walls/gates/towers/keep need stone+bricks, bridges need wood.
  Reaching forests and mountains requires roads -> exploration has a purpose.
- **Connectivity**: every new construction must touch the existing network (4-adjacency).
  Woodcutters need an adjacent forest, quarries adjacent mountains, bridges go on rivers,
  fields on grass. Mountains are unbuildable.
- **Wall logic (enclosure)**: flood-fill check; a building is protected only when a closed
  ring of built walls/gates/towers encloses it AND the ring contains >= 1 gate.
  Raids ruin only unprotected buildings. Battle routs (correct < target/3) breach walls.
- **Enemy camps**: spawn every ~140 ticks (max 3), march 1 step per 5 ticks toward the
  nearest building; blocked by mountains and rivers except at bridges. A camp adjacent to
  your buildings forces a battle early in the next session (severity = camp strength).
  Win destroys the camp and loots; defeat burns something and the camp stays.
- **Treasure**: chests hidden in the fog; ~40% hold an alef-bet letter collectible
  (collection tracked in Stats), the rest coins scaled by distance. Tap to collect.
- **Demolish mode**: tear anything down, no refund.
- **Guardian upkeep**: eats 2 food/day (on the daily check); starving guardians lose a
  level per day. Crop fields keep them fed.
- **Migration**: old saves get zeroed new resources, tick 0, no camps; empty castles
  receive the starting plot. `unlockedCategories` field added (null = all) as the hook
  for the upcoming thematic-cities feature.

## 15. Learning-first pivot (2026-07-04, current)

Sanch: "more game now than learning process… build up from scratch a system to learn
words. No adventures, no castles." The app is now a clean vocabulary trainer.

**Kept:** the data (968 words, 113 sentences), the SRS engine (8 boxes, recognition ->
recall -> mastered at recall box 4), all exercises (multiple choice both directions,
fill-the-blank, match pairs, sound match, speed round), Hebrew TTS, daily time goal
with streak, profiles, backup, all engine tests.

**Removed from the UI:** castle, world map, resources, camps, attacks, guardian.
Game engines remain in src/lib (tested, dormant); game UI files deleted (git has them).

**New structure:**
- **Learn (home):** "Daily session" button (due reviews from all topics + new words),
  60s speed round, and a topic grid — one card per category with emoji, due badge and a
  progress bar (blue = started, gold = mastered). Tapping a topic starts a session
  scoped to it (its due words + its new words, same daily limits).
- **Session:** same exercise flow; battles removed; summary shows cards, accuracy,
  minutes today and words mastered this session.
- **Stats:** mastered/started/streak/total practice hours, per-topic progress table,
  memory-level (SRS box) charts, day-by-day history.
- **Settings:** SRS knobs, exercise toggles, profiles, backup. Attack setting removed.

Session planning: `buildSessionPlan` gained a `topic` filter (due + new both scoped).

## 16. Auto-listening counts toward progress (2026-07-26)

Sanch: listening should feed `started` and `mastered` too — but slower, because it is
unclear how much of it actually sticks. So listening earns progress on a separate,
unverified track that converts into SRS boxes and stops short of every milestone that
is supposed to prove knowledge.

**Exposures.** `GameState.exposures` maps `wordId|direction` → `{count, days}`. One
exposure is counted only when a pair plays all the way through (term, pause,
translation) — skipping or pausing mid-pair earns nothing. A credit needs
`HEARD_PER_CREDIT = 3` exposures spread over `HEARD_MIN_DAYS = 2` distinct days, so
looping a short playlist for an hour buys nothing; only coming back another day does.
Days are the real brake, and each further box step needs a fresh 2-day spread.

**What a credit buys.**
- No `ReviewState` yet → the word is introduced at box 0, i.e. it becomes **started**.
  These passive introductions draw on the same `newWordsPerDay` budget as sessions, so
  listening cannot flood tomorrow's review queue; an earned credit waits if the budget
  is spent.
- Already learning → box +1, capped by `PASSIVE_MAX_BOX`: recognition 1
  (`RECALL_UNLOCK_BOX - 1`), recall 2 (`GRADUATION_BOX - 1`). Unlocking recall and
  graduating therefore always cost at least one real answer. **Mastery is never passive.**
- Forward listening credits `recognition`; ↔ Reverse credits `recall` (that is the
  direction it trains), falling back to recognition while recall is still locked.
- A credit raises the box but **never moves `dueAt`** — otherwise the more you listened,
  the less you would be tested, which is exactly backwards.

**Honesty.** A passively-raised box carries `passive: true` until an answer settles it.
A wrong first answer collapses it to box 0 rather than the usual -2: that level was
never earned. Stats show how many levels are unconfirmed, Vocabulary marks them 🎧, and
`DayLog.heard` records pairs played per day.

The playlist is built from a snapshot of `reviews` that only refreshes while stopped —
crediting mid-playback would otherwise reorder the list under the running loop.

### Background playback

`speechSynthesis` is suspended when the screen locks (always on iOS) and the pauses run
on `setTimeout`, which freezes in background — so live TTS can never play locked, and
`MediaSession` (the lock-screen widget) needs a real media element it cannot provide.

Shipped for now: **Screen Wake Lock** (`useWakeLock`) — the screen simply doesn't sleep
while listening, re-acquired on becoming visible again. Not background playback.

Deferred (Sanch: "потім будемо думати"): pre-render clips with `say -v Carmit` (the
`fix-stress.mjs` pipeline already does this), concatenate ~15-20 pairs with their
silences into one WAV blob client-side, play it through a single `<audio>` element with
`MediaSession` handlers, and seek by offset for prev/next. That is the only route to
real locked-screen playback, and the reason the `heard` action takes an array of word
ids: a background player credits a whole stretch of audio at once on resume.

## 17. Tunable listening pauses + duplicate collapsing (2026-07-26)

**Pauses.** Auto-listening exposes both silences as dropdowns above "Done", labelled
as Sanch named them: **a** = between the word and its translation, **b** = before the
next word. Range 1-20 s, stored in Settings (`listenPauseSec` / `listenGapSec`), so
they survive reloads and follow the profile. `pauseAfterMs` still stretches the chosen
`a` by 1.5× for long phrases and sentences.

**Duplicates.** The same word appeared as several cards — בית three times — because
`buildWords` keys ids on `hebrewFull|translation|category`, and the CSV grew by merging
several source documents: a curated row (`אבא (ז')אבות`) plus a bare row from a later
import (`אבא`), sometimes under a different category. Two cards with the same Hebrew
prompt are unanswerable in multiple choice and double-count topic progress.

`dedupeWords` (a pipeline step, not part of `buildWords`) now collapses rows by base
word: the survivor is the richest row (plural/gender), tie-broken by the category the
group agrees on, then row order — which is why בית lands in Public Places (2 of its 3
rows) rather than School / Ulpan. Same-language glosses are unioned ("sorry" +
"excuse me/sorry" → "sorry / excuse me"); cross-language ones are left to the English
override step. 52 of 1285 rows merged away, 1233 words remain, 0 duplicate base forms.

Survivor ids are untouched, so their progress, nikud and transliteration all still
match. `merged-ids.json` maps every dropped id to its survivor and
`remapMergedProgress` (called from `deserializeState`, injected via `main.tsx`) folds
progress recorded on a dropped twin into the survivor — keeping the further-along box
per direction, preferring a verified box over a passive one, and not summing exposure
counters. Without it, learning done on a duplicate card would vanish silently.

A group whose same-language glosses share no meaning is reported as a possible
homograph rather than merged silently. On the current data exactly one fires:
ביצה "яйце" vs "Скрамбл" — the known Food & Drinks translation shift, not a homograph.

### Auto-listening on the other courses (2026-07-26)

The exercise is course-agnostic now. `Course` gained `translationSpeechLang` (the voice
for the translation side: en-US for Hebrew, **uk-UA for English → Українська**, en-US
for Español → English) — it used to be hard-coded to en-US, so Ukrainian translations
were read out by an English voice. The card also stops forcing RTL for LTR courses, and
for the Duolingo courses (`commaMeanings`) only the **first** meaning is spoken while the
card still shows the whole list: reading "тайминг, ритмом, такт" aloud is noise.

If the device has no voice for the translation language the screen says so, rather than
letting the engine silently substitute a wrong-language voice.

The started-words gate on the entry button is gone: listening is also how you first meet
new words, so a freshly opened course would otherwise hide the exercise entirely.
