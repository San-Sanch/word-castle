# Word Castle: Hebrew Vocabulary Game (MVP Spec)

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
