import { useRef, useState } from 'react'

/** Distinguishes a tap from a ~1s long-press on the same element. Returns pointer
 * handlers plus a `pressing` flag (true while the finger is down, for a hold
 * animation): a quick release fires `onTap`, holding past `ms` fires `onLongPress`
 * (and suppresses the tap). */
export function useLongPress(onTap: () => void, onLongPress: () => void, ms = 1000) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const [pressing, setPressing] = useState(false)

  const clear = () => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  const start = () => {
    fired.current = false
    setPressing(true)
    clear()
    timer.current = window.setTimeout(() => {
      fired.current = true
      setPressing(false)
      onLongPress()
    }, ms)
  }

  const finish = () => {
    clear()
    setPressing(false)
    if (!fired.current) onTap()
  }

  const cancel = () => {
    clear()
    setPressing(false)
    fired.current = true // a leave/cancel shouldn't count as a tap
  }

  return {
    pressing,
    ms,
    handlers: {
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
    },
  }
}
