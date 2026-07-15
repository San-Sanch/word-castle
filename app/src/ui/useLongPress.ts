import { useRef } from 'react'

/** Distinguishes a tap from a ~1s long-press on the same element. Returns pointer
 * handlers to spread onto a button: a quick release fires `onTap`, holding past
 * `ms` fires `onLongPress` (and suppresses the tap). */
export function useLongPress(onTap: () => void, onLongPress: () => void, ms = 700) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)

  const clear = () => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  const start = () => {
    fired.current = false
    clear()
    timer.current = window.setTimeout(() => {
      fired.current = true
      onLongPress()
    }, ms)
  }

  const finish = () => {
    clear()
    if (!fired.current) onTap()
  }

  const cancel = () => {
    clear()
    fired.current = true // a leave/cancel shouldn't count as a tap
  }

  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      start()
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      finish()
    },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
  }
}
