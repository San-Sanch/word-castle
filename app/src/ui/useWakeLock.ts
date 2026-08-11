import { useEffect, useRef, useState } from 'react'

// Screen Wake Lock API — not in the TS DOM lib everywhere, so it's typed locally.
interface WakeLockSentinelLike {
  released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', cb: () => void): void
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

function wakeLock(): WakeLockLike | null {
  const nav = navigator as unknown as { wakeLock?: WakeLockLike }
  return nav.wakeLock ?? null
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && wakeLock() !== null
}

/** 'off' while inactive, 'asking' until the browser answers the request (the
 * answer takes a moment on phones — warning during that window would flash a
 * false alarm on every play), then 'held' or 'refused'. */
export type WakeLockStatus = 'off' | 'asking' | 'held' | 'refused'

/** Keeps the screen awake while `active`. The browser drops the lock whenever the
 * page is hidden (tab switch, manual lock), so it is re-acquired on becoming
 * visible again. Playback keeps working without the lock, so a refusal is a
 * caveat to show, not an error. */
export function useWakeLock(active: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>('off')
  const setHeld = (on: boolean) => setStatus(on ? 'held' : 'refused')
  const sentinel = useRef<WakeLockSentinelLike | null>(null)

  useEffect(() => {
    const api = wakeLock()
    if (!api) {
      setStatus(active ? 'refused' : 'off')
      return
    }
    let cancelled = false

    const release = () => {
      const s = sentinel.current
      sentinel.current = null
      setStatus('off')
      if (s && !s.released) s.release().catch(() => {})
    }

    const acquire = () => {
      if (cancelled || sentinel.current || document.visibilityState !== 'visible') return
      api
        .request('screen')
        .then((s) => {
          if (cancelled) {
            s.release().catch(() => {})
            return
          }
          sentinel.current = s
          setHeld(true)
          // the system can revoke it (battery saver, manual lock)
          s.addEventListener('release', () => {
            if (sentinel.current === s) {
              sentinel.current = null
              setHeld(false)
            }
          })
        })
        .catch(() => setHeld(false))
    }

    if (!active) {
      release()
      return
    }

    setStatus('asking')
    acquire()
    const onVisibility = () => (document.visibilityState === 'visible' ? acquire() : setStatus('asking'))
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [active])

  return status
}
