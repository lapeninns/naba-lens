"use client"

import * as React from "react"
import { ArrowClockwiseIcon, WifiSlashIcon } from "@phosphor-icons/react"
import { usePathname, useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

import { formatDate, formatTime } from "./format"
import { Notice } from "./notice"

export const OFFLINE_COPY = {
  title: "You're offline",
  loadedAt: (time: string) => `Loaded at ${time}.`,
  offlineSince: (time: string) => `You've been offline since ${time}.`,
  loadedOffline: "This page was loaded offline; it may be out of date.",
  action: "Try again",
} as const

/**
 * The banner's place at the top of a page: edge to edge under the bar on
 * phones, a card in the page column from md (Common Room).
 */
export const OFFLINE_BANNER_CLASS =
  "-mx-(--page-gutter) -mt-4 mb-3 rounded-none md:mx-0 md:mt-0 md:mb-8 md:rounded-card"

/** What the banner can truthfully say about the page's age. */
type OfflineTimes = {
  /** When the content on screen was rendered or last refreshed; null when unknown. */
  loadedAt: Date | null
  /** When this page saw the connection drop; null when it never saw it. */
  offlineSince: Date | null
  /** The browser was already offline when this page mounted. */
  loadedOffline: boolean
}

const londonYear = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  timeZone: "Europe/London",
})

/** "14:06", with the date when it isn't today in London (and so the year). */
export function offlineTime(date: Date, now: Date): string {
  const time = formatTime(date)
  const day = formatDate(date.toISOString())
  if (day === formatDate(now.toISOString())) return time
  return londonYear.format(date) === londonYear.format(now)
    ? `${time} on ${day.replace(/ \d{4}$/, "")}`
    : `${time} on ${day}`
}

/** The banner's sentence about time; never a time that isn't known. */
export function offlineBody(times: OfflineTimes, now: Date): string {
  if (times.loadedOffline) return OFFLINE_COPY.loadedOffline
  return [
    times.loadedAt
      ? OFFLINE_COPY.loadedAt(offlineTime(times.loadedAt, now))
      : null,
    times.offlineSince
      ? OFFLINE_COPY.offlineSince(offlineTime(times.offlineSince, now))
      : null,
  ]
    .filter(Boolean)
    .join(" ")
}

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
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

// Set by OfflineShell, per page frame: never shared between pages.
const Times = React.createContext<OfflineTimes | null>(null)

/**
 * The page frame's times. `loadedAt` comes from the server render, so a
 * re-render (navigation, router.refresh()) moves it. A frame that outlives
 * navigations (a layout) isn't re-rendered when its page changes, so its
 * time no longer describes the page: it is dropped until the next refresh,
 * unless the page's own OfflineNotice brings one.
 */
function useOfflineTimes(
  loadedAt: string | undefined,
  pathname: string | undefined
): OfflineTimes {
  const [loadedOffline] = React.useState(
    () => typeof navigator !== "undefined" && !navigator.onLine
  )
  const [offlineSince, setOfflineSince] = React.useState<Date | null>(null)
  const [stamp, setStamp] = React.useState({
    source: loadedAt,
    pathname,
    at: loadedAt,
  })
  if (stamp.source !== loadedAt || stamp.pathname !== pathname) {
    setStamp({
      source: loadedAt,
      pathname,
      at: stamp.source !== loadedAt ? loadedAt : undefined,
    })
  }

  React.useEffect(() => {
    const onOffline = () => setOfflineSince(new Date())
    const onOnline = () => setOfflineSince(null)
    window.addEventListener("offline", onOffline)
    window.addEventListener("online", onOnline)
    return () => {
      window.removeEventListener("offline", onOffline)
      window.removeEventListener("online", onOnline)
    }
  }, [])

  // One object per actual change: this value sits in a context above the
  // page's streamed Suspense boundaries, and a new object there while a
  // boundary is still waiting makes React render that boundary again in the
  // browser beside the server's copy (see add-context.tsx).
  return React.useMemo(
    () => ({
      loadedAt: stamp.at ? new Date(stamp.at) : null,
      offlineSince,
      loadedOffline,
    }),
    [stamp.at, offlineSince, loadedOffline]
  )
}
/**
 * Wraps a signed-in page's content. While offline it shows one OfflineNotice
 * above the page, unless the page renders its own somewhere in its flow.
 * `loadedAt` is the server's render time (ISO) of what is on screen.
 */
export function OfflineShell({
  loadedAt,
  page,
  children,
}: {
  loadedAt?: string
  /** For a frame that outlives navigations: the page it is showing now. */
  page?: string
  children: React.ReactNode
}) {
  const [pageNotices, setPageNotices] = React.useState(0)
  const register = React.useCallback<Register>(
    (delta) => setPageNotices((n) => n + delta),
    []
  )
  const online = useOnline()
  const times = useOfflineTimes(loadedAt, page)
  return (
    <Times value={times}>
      <PageNotices value={register}>
        {/* Mounted only while it shows: OfflineNotice needs the app router. */}
        {online || pageNotices > 0 ? null : (
          <PageNotices value={null}>
            <OfflineNotice className={OFFLINE_BANNER_CLASS} />
          </PageNotices>
        )}
        {children}
      </PageNotices>
    </Times>
  )
}

/** OfflineShell for a layout's frame, which stays put while pages change. */
export function LayoutOfflineShell({
  loadedAt,
  children,
}: {
  loadedAt?: string
  children: React.ReactNode
}) {
  return (
    <OfflineShell loadedAt={loadedAt} page={usePathname() ?? undefined}>
      {children}
    </OfflineShell>
  )
}

const UNKNOWN: OfflineTimes = {
  loadedAt: null,
  offlineSince: null,
  loadedOffline: false,
}

/**
 * Shown above the last loaded content while the browser is offline. The page
 * keeps what it has; "Try again" refreshes it once the connection is back.
 * A page under a layout's frame passes its own render time (`loadedAt`,
 * ISO), since the frame's isn't re-rendered when the page changes.
 */
export function OfflineNotice({
  className,
  loadedAt,
}: {
  className?: string
  loadedAt?: string
}) {
  const online = useOnline()
  const router = useRouter()
  const register = React.useContext(PageNotices)
  const frame = React.useContext(Times) ?? UNKNOWN
  const times = loadedAt ? { ...frame, loadedAt: new Date(loadedAt) } : frame
  React.useEffect(() => {
    if (!register) return
    register(1)
    return () => register(-1)
  }, [register])
  if (online) return null
  const body = offlineBody(times, new Date())
  return (
    <Notice
      tone="negative"
      icon={WifiSlashIcon}
      title={OFFLINE_COPY.title}
      className={className}
      action={
        <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
          <ArrowClockwiseIcon aria-hidden />
          {OFFLINE_COPY.action}
        </Button>
      }
    >
      {body || null}
    </Notice>
  )
}
