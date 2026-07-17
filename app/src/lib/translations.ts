/** Splits a translation into browsable meanings — but only for courses whose
 * data uses comma-separated meaning lists (the Duolingo courses). The curated
 * Hebrew course uses commas inside phrases ("the bill, please"), so there the
 * whole translation is always a single part. */
export function translationParts(text: string, split: boolean): string[] {
  if (!split) return [text]
  return text
    .split(/,\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
}
