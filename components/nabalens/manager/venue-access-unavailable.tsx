"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { LockSimpleIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

import { Card } from "../common-room/card"
import { IconDisc } from "../common-room/icon-disc"
import { MANAGER_COPY } from "./copy"

export type VenueAccessUnavailableReason =
  keyof typeof MANAGER_COPY.unavailable.reason

const COPY = MANAGER_COPY.unavailable

/**
 * A manager account without a working venue workspace (no open grant, the
 * venue moved, or the venue is inactive). It offers nothing but Sign out and
 * the way forward: ask an admin. The heading takes focus so screen readers
 * hear why the workspace is not there.
 *
 * `refreshShell`: rendered by a page inside the workspace shell, which a
 * client navigation keeps after access ended. One refresh re-renders the
 * layout, which then shows the page without nav (and never this flag).
 */
export function VenueAccessUnavailable({
  reason,
  refreshShell = false,
}: {
  reason: VenueAccessUnavailableReason
  refreshShell?: boolean
}) {
  const heading = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <Card
      as="section"
      aria-labelledby="venue-access-unavailable"
      data-slot="venue-access-unavailable"
      className="max-w-(--size-reading)"
    >
      <IconDisc tone="warn">
        <LockSimpleIcon />
      </IconDisc>
      <h1
        id="venue-access-unavailable"
        ref={heading}
        tabIndex={-1}
        className="font-display text-page-title [overflow-wrap:anywhere] text-ink outline-none"
      >
        {COPY.title}
      </h1>
      <p className="text-body text-ink">{COPY.body}</p>
      <p className="text-body text-ink-muted">{COPY.reason[reason]}</p>
      {refreshShell ? <RefreshShellOnce /> : null}
      <form action="/auth/logout" method="post" className="mt-1">
        <Button
          type="submit"
          variant="primary"
          size="touch"
          className="max-md:w-full"
        >
          {COPY.signOut}
        </Button>
      </form>
    </Card>
  )
}

function RefreshShellOnce() {
  const router = useRouter()
  React.useEffect(() => {
    router.refresh()
  }, [router])
  return null
}

/** The whole page for the unavailable state: the wordmark only, no nav. */
export function VenueAccessUnavailablePage({
  reason,
}: {
  reason: VenueAccessUnavailableReason
}) {
  return (
    <div className="flex min-h-svh flex-col bg-bg text-ink">
      <header className="relative z-10 bg-surface shadow-[0_1px_0_var(--line)]">
        <div className="mx-auto flex min-h-15 w-full max-w-(--size-page) items-center px-3 md:px-6">
          <span className="font-display text-[1.5rem] leading-none font-extrabold tracking-[-0.02em] text-ink">
            Naba-Lens
          </span>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto w-full max-w-(--size-page) flex-1 overflow-x-clip px-(--page-gutter) py-6 md:px-6 md:py-12"
      >
        <VenueAccessUnavailable reason={reason} />
      </main>
    </div>
  )
}
