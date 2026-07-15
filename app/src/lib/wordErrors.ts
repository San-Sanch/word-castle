import type { Word } from './types.js'

export type WordErrorStatus = 'error' | 'fixed'

/** Icon shown in the Vocabulary "words with errors" view. */
export function errorIcon(status: WordErrorStatus): string {
  return status === 'fixed' ? '✅' : '❌'
}

/** Reporting a word always marks it 'error' — even a previously 'fixed' word,
 * which signals the maintainer that the fix didn't actually work. */
export function statusAfterReport(): WordErrorStatus {
  return 'error'
}

/** The words currently on the error list, in the given word order, paired with
 * their status. Words missing from `errors` are excluded. */
export function wordsWithErrors(
  words: Word[],
  errors: Record<string, WordErrorStatus>,
): Array<{ word: Word; status: WordErrorStatus }> {
  return words.filter((w) => errors[w.id]).map((w) => ({ word: w, status: errors[w.id] }))
}
