"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import type { SwitchVenueResult } from "@/lib/auth/venues"

export type VenueSwitcherVenue = {
  venueId: string
  venueName: string
  role: "staff" | "manager" | "admin"
  isActive: boolean
}

const ROLE_WORD = { staff: "Staff", manager: "Manager", admin: "Admin" }

// The person's other tabs hear a venue change at once (AC11, S3-E2E-1 E7):
// an open Match there re-reads the venue instead of matching photos to the
// old venue's slots until its next navigation.
const VENUE_CHANNEL = "nabalens-active-venue"

function venueChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(VENUE_CHANNEL)
}

/** Tells this browser's other tabs that the active venue changed. */
export function announceVenueChange(venueId: string) {
  const channel = venueChannel()
  if (!channel) return
  channel.postMessage({ venueId })
  channel.close()
}

/** Calls `onChange` when another tab of this browser changes venue. */
export function useVenueChanges(onChange: (venueId: string) => void) {
  const latest = React.useRef(onChange)
  React.useLayoutEffect(() => {
    latest.current = onChange
  })
  React.useEffect(() => {
    const channel = venueChannel()
    if (!channel) return
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { venueId?: unknown } | null
      if (typeof data?.venueId === "string") latest.current(data.venueId)
    }
    return () => channel.close()
  }, [])
}

/**
 * The active venue and, for a person with more than one venue, a way to work
 * at another (spec §3.1, FA-22). It lists only the person's own venues, and
 * the database refuses any other id: changing venue never grants access. The
 * role at each venue is shown beside its name, because staff and manager
 * screens differ. Renders nothing with fewer than two venues.
 */
export function VenueSwitcher({
  venues,
  onSwitch,
}: {
  venues: VenueSwitcherVenue[]
  onSwitch: (venueId: string) => Promise<SwitchVenueResult & { home?: string }>
}) {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const id = React.useId()
  const active = venues.find((v) => v.isActive) ?? null
  const [choice, setChoice] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  if (venues.length < 2) return null

  const options = venues
    .filter((v) => !v.isActive)
    .map((v) => ({
      id: v.venueId,
      name: `${v.venueName} · ${ROLE_WORD[v.role]}`,
    }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!choice) {
      setError("Choose a venue.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await onSwitch(choice)
      if (!result.ok) {
        setError(
          result.code === "not_a_member"
            ? "You no longer work at that venue. Ask your manager."
            : "The venue could not be changed. Try again."
        )
        return
      }
      announceVenueChange(choice)
      router.push(result.home ?? "/")
      router.refresh()
    } catch (cause) {
      setError(
        sessionEnded(cause) ??
          "We couldn't change venue. Check your connection and try again."
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3"
      aria-labelledby={`${id}-title`}
    >
      <p id={`${id}-title`} className="text-body text-ink">
        Working at{" "}
        <strong>
          {active
            ? `${active.venueName} · ${ROLE_WORD[active.role]}`
            : "no venue"}
        </strong>
      </p>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-venue`} className="text-label text-ink">
          Work at another venue
        </label>
        <OptionSelect
          id={`${id}-venue`}
          options={options}
          value={choice}
          onValueChange={setChoice}
          placeholder="Choose a venue"
          disabled={pending}
        />
      </div>
      {error ? <Notice tone="negative">{error}</Notice> : null}
      <Button
        type="submit"
        variant="secondary"
        loading={pending}
        className="justify-self-start"
      >
        Change venue
      </Button>
    </form>
  )
}
