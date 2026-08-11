# Tech debt / deferred work

## Open

- **Auto-listening still can't play with a locked screen** (2026-07-26). Shipped
  Screen Wake Lock as the stopgap (screen stays on); real background audio needs
  the pre-rendered-clips route in SPEC §16. Sanch deferred it.

- **~115 slash/variant entries lack transliteration, some lack nikud** (noted
  2026-07-24, after the Slack import of 317 words). `transliterate.mjs` dropped
  115 "no nikud available" tokens; a few new slash-verb sets (e.g. plural forms)
  speak unvocalized. Pre-existing pattern, now larger. Fix: rerun vocalize.mjs
  (Dicta) and add manual overrides for the stubborn ones.
- **Category taxonomy has no bucket for professions / money / generic people**
  (noted 2026-07-24). The Slack import routed professions→School/Ulpan,
  money/commerce→Public Places, generic people→Family as least-bad fits. If
  Sanch wants cleaner topics, add categories and recategorize those rows.
- **A few imported entries kept placeholders/typos verbatim** (2026-07-24):
  `זקו` (likely typo for זקן), `לבקר ב…(מקום)` / `לבקר אצל (משפחה)` keep the
  `…`/`(...)` usage hints, `מסמך (ז'` missing closing paren. Left as source
  posted them; Sanch can clean in hebrew_words.csv + rerun the pipeline.


- **hebrew_words.csv row 183 parses wrong** (noted 2026-07-17). The row
  `זאת בחירה (נ') מצוינת/טובה,Це гарний вибір` puts the adjective after the
  gender marker, so the parser reads `מצוינת/טובה` as a PLURAL and the word
  becomes just `זאת בחירה`. App-side workaround applied: English translation
  override changed to "that's a choice" so audio and translation match, but
  the word detail still shows the bogus "plural: מצוינת/טובה" and the lesson
  content ("гарний вибір") is lost. Proper fix: Sanch edits the CSV row (e.g.
  `זאת בחירה טובה (נ'),Це гарний вибір`) and the data pipeline is rerun
  (update-word-data skill). Waiting on Sanch's decision — source CSV is his.

- **4 slash entries have no vocalization at all** (noted 2026-07-17, pre-existing):
  רווק/רווקה, מטייל/מטיילת, מאוחר/…, מוקדם/… — absent from vocalized.json
  (full AND tokens), so the voice reads them unvocalized. Fix: rerun
  `node scripts/vocalize.mjs` (needs internet/Dicta) or add manual overrides.

## Resolved

- ~~9 flagged pronunciations couldn't be fixed blind~~ (2026-07-17): Sanch
  decided all should speak plain Dicta nikud without respelling hacks (like
  בית) and slash entries get a period pause. Done same day; all 18 flags set
  to `fixed` — anything still wrong will come back via re-reporting.
