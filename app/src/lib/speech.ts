// Hebrew text-to-speech via the Web Speech API (system voices, works offline).

let voices: SpeechSynthesisVoice[] = []

function refreshVoices(): void {
  voices = window.speechSynthesis.getVoices()
}

export function initSpeech(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  refreshVoices()
  window.speechSynthesis.onvoiceschanged = refreshVoices
}

function hebrewVoice(): SpeechSynthesisVoice | null {
  return voices.find((v) => v.lang.toLowerCase().startsWith('he')) ?? null
}

export function canSpeakHebrew(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && hebrewVoice() !== null
}

/**
 * Prepares dictionary entries for speech: "עובד/עובדת (ב)" is written for the eye,
 * not the voice. Parenthesized grammar hints are dropped and slash-separated forms
 * become comma pauses.
 */
export function ttsNormalize(text: string): string {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s*\/\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*$/g, '')
    .trim()
}

export function speakHebrew(text: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  const utterance = new SpeechSynthesisUtterance(ttsNormalize(text))
  const voice = hebrewVoice()
  if (voice) utterance.voice = voice
  utterance.lang = 'he-IL'
  utterance.rate = 0.85
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  return true
}
