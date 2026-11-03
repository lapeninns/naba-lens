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

/**
 * Shown above the last loaded content while the browser is offline. The page
 * keeps what it has; "Try again" refreshes it once the connection is back.
 */
export function OfflineNotice({ className }: { className?: string }) {
  const online = useOnline()
  const router = useRouter()
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
