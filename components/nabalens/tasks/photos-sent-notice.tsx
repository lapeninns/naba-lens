"use client"

import * as React from "react"

import { Notice } from "../notice"

/** The query a send leaves on Home (`?sent=2&task=<id>`, `?replaced=1`). */
export const SENT_PARAMS = ["sent", "replaced", "task"] as const

/**
 * "2 photos sent to …" on Home after a send. It takes focus on arrival (the
 * panel that sent them is gone) and takes its parameters out of the address
 * at once, so a reload or Back doesn't announce the send again.
 */
export function PhotosSentNotice({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    ref.current?.focus()
    const url = new URL(window.location.href)
    if (!SENT_PARAMS.some((name) => url.searchParams.has(name))) return
    for (const name of SENT_PARAMS) url.searchParams.delete(name)
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    )
  }, [])

  return (
    <Notice ref={ref} tabIndex={-1} tone="positive" role="status">
      {children}
    </Notice>
  )
}
