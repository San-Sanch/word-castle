---
name: update-word-data
description: Regenerate all Word Castle word data after source docs change — new or updated rows in hebrew_words.csv, hebrew_sentences.csv or hebrew_vocabulary_categorized.csv. Rebuilds words/sentences JSON, English translation overrides, Dicta vocalization (nikud), and Latin transcriptions, with quality gates. Use when Sanch says he added/updated words, lessons, or source docs.
---

# Update Word Castle word data

The app bundles generated JSON built from the source CSVs at the repo root.
Whenever `hebrew_words.csv`, `source-data/hebrew_sentences.csv` or
`source-data/hebrew_vocabulary_categorized.csv` change (new rows OR edits to
existing rows), run this full pipeline from `word-castle/app/`.

## Pipeline (order matters)

1. **Compile libs used by scripts** (they import from `.test-build/`):
   `npm test` — must be green before continuing.
2. **Words + sentences**: `node scripts/convert-data.mjs`
   - Prints counts: words, english overrides applied, `words still ua: N`.
3. **English overrides for new Ukrainian rows**: if `words still ua` > 0,
   find them (`node -e` over `src/data/words.json`, filter
   `translationLang === 'ua'`), translate each **from the Hebrew column**
   (the UA text may be shifted/wrong — see SPEC §13) and add entries to
   `src/data/translation-overrides.json` keyed by word id. Re-run step 2
   until `words still ua: 0`.
4. **Vocalization (needs internet)**: `node scripts/vocalize.mjs`
   - Calls the Dicta Nakdan API for every word/plural/sentence and overlays
     the human nikud from `hebrew_vocabulary_categorized.csv`.
   - A few "skeleton mismatch" skips are normal (Dicta normalizes spelling).
   - If offline: skip, note that new words will speak unvocalized until rerun.
5. **Transcriptions**: `node scripts/transliterate.mjs`
   - Hand-written transliterations from the categorized CSV win; the rest are
     romanized from the vocalized forms. Vowel-less garbage is dropped.
6. **Checks**: `npm test && npx tsc --noEmit && npx vite build` — all green.
7. **Spot checks** (read the script outputs):
   - uncle = `dod`, breakfast = `a-ru-KHAT BO-ker`
   - a couple of the NEW words: sensible transliteration and vocalization.
8. **Commit** the regenerated files: `src/data/words.json`,
   `src/data/sentences.json`, `src/data/vocalized.json`,
   `src/data/translit.json`, plus `translation-overrides.json` if touched.

## Pronunciation corrections

If Sanch reports a word the voice reads wrong:
- Add it to `PRONUNCIATION_OVERRIDES` in `src/lib/speech.ts` with the intended
  vowelized spelling and a comment. These win over generated data everywhere
  (audio AND transcriptions after step 5 rerun).
- Known tricks: meteg `ֽ` for stress (מַֽיִם = MA-im); the tsere-yud "ei"
  glide is already handled globally by `forceEiGlide` — do not add overrides
  for plain e/ei issues; Dicta sometimes picks the wrong homograph (מַכְתֵּב
  vs מִכְתָּב) — that is exactly what the override list is for.
- Add a matching test in `src/lib/speech.test.ts`.

## Source-data quirks to remember

- `hebrew_words.csv` has a one-row translation shift in Food & Drinks
  (~rows 72-105) — never trust the UA column there; translate from Hebrew.
- Gender markers appear as (ז'), (נ"), (ז), (זי), (ז'( and (ז'/נ') — the
  parser handles all of these; if a new variant shows up, extend
  `parseHebrewEntry` in `src/lib/dataParse.ts` (test first).
- Duplicate rows are kept intentionally (source data is authoritative).
