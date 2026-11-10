"use client"

import * as React from "react"

/** How long a write may run before the screen says it is still going. */
export const STILL_WAITING_MS = 15_000

/**
 * True once `active` has stayed true for `ms`: the "still saving" stage of a
 * slow write. Goes back to false as soon as the write ends.
 */
export function useStillWaiting(active: boolean, ms = STILL_WAITING_MS) {
  const [late, setLate] = React.useState(false)
  React.useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => setLate(true), ms)
    return () => {
      window.clearTimeout(timer)
      setLate(false)
    }
  }, [active, ms])
  return active && late
}
