/** A clock-like ring that sweeps full over `ms` while a button is held. Rendered
 * as an overlay centered on its (position:relative) parent. */
export function HoldRing({ ms }: { ms: number }) {
  const r = 15
  const c = 2 * Math.PI * r
  return (
    <span className="hold-ring" aria-hidden>
      <svg viewBox="0 0 36 36">
        <circle className="hold-ring-bg" cx="18" cy="18" r={r} />
        <circle
          className="hold-ring-fg"
          cx="18"
          cy="18"
          r={r}
          style={{ strokeDasharray: c, strokeDashoffset: c, animationDuration: `${ms}ms` }}
        />
      </svg>
    </span>
  )
}
