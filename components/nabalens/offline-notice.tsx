"use client"

import * as React from "react"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

import { formatTime } from "./format"
import { Notice } from "./notice"

export const OFFLINE_COPY = {
  title: "You're offline",
  body: (time: string) =>
    `What you see was last updated at ${time}. Nothing is sent twice when you try again.`,
  action: "Try again",
} as const

// When the connection last dropped: what is on screen was loaded before it.
let wentOfflineAt: Date | null = null

function subscribe(onChange: () => void) {
  const onOffline = () => {
    wentOfflineAt = new Date()
    onChange()
  }
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onOffline)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onOffline)
  }
}

/** Whether the browser reports a connection; true on the server. */
export function useOnline(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true
  )
}

type Register = (delta: 1 | -1) => void

// Set by OfflineShell: a page's own notice registers here so the shell's
// fallback copy stays hidden and the page's designed placement wins.
const PageNotices = React.createContext<Register | null>(null)

/**
 * Wraps a signed-in page's content. While offline it shows one OfflineNotice
 * above the page, unless the page renders its own somewhere in its flow.
 */
export function OfflineShell({ children }: { children: React.ReactNode }) {
  const [pageNotices, setPageNotices] = React.useState(0)
  const register = React.useCallback<Register>(
    (delta) => setPageNotices((n) => n + delta),
    []
  )
  const online = useOnline()
  return (
    <PageNotices value={register}>
      {/* Mounted only while it shows: OfflineNotice needs the app router. */}
      {online || pageNotices > 0 ? null : (
        <PageNotices value={null}>
          <OfflineNotice className="mb-6 md:mb-8" />
        </PageNotices>
      )}
      {children}
    </PageNotices>
  )
}

/**
 * Shown above the last loaded content while the browser is offline. The page
 * keeps what it has; "Try again" refreshes it once the connection is back.
 */
export function OfflineNotice({ className }: { className?: string }) {
  const online = useOnline()
  const router = useRouter()
  const register = React.useContext(PageNotices)
  React.useEffect(() => {
    if (!register) return
    register(1)
    return () => register(-1)
  }, [register])
  if (online) return null
  return (
    <Notice
      tone="negative"
      title={OFFLINE_COPY.title}
      className={className}
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => router.refresh()}
        >
          <ArrowClockwiseIcon aria-hidden />
          {OFFLINE_COPY.action}
        </Button>
      }
    >
      {OFFLINE_COPY.body(formatTime(wentOfflineAt ?? new Date()))}
    </Notice>
  )
}
