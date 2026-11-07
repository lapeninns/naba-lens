"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"

import { MANAGER_COPY } from "./copy"

export type VenueAccessUnavailableReason =
  keyof typeof MANAGER_COPY.unavailable.reason

const COPY = MANAGER_COPY.unavailable

/**
 * A manager account without a working venue workspace (no open grant, the
 * venue moved, or the venue is inactive). It offers nothing but Sign out and
 * the way forward: ask an admin. The heading takes focus so screen readers
 * hear why the workspace is not there.
 */
export function VenueAccessUnavailable({
  reason,
}: {
  reason: VenueAccessUnavailableReason
}) {
  const heading = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <section
      aria-labelledby="venue-access-unavailable"
      data-slot="venue-access-unavailable"
      className="grid max-w-(--size-reading) gap-3"
    >
      <h1
        id="venue-access-unavailable"
        ref={heading}
        tabIndex={-1}
        className="font-display text-page-title text-ink outline-none"
      >
        {COPY.title}
      </h1>
      <p className="text-body-touch text-ink md:text-body">{COPY.body}</p>
      <p className="text-body-touch text-ink-muted md:text-body">
        {COPY.reason[reason]}
      </p>
      <form action="/auth/logout" method="post" className="mt-3">
        <Button type="submit" variant="primary" size="touch">
          {COPY.signOut}
        </Button>
      </form>
    </section>
  )
}

/** The whole page for the unavailable state: the wordmark only, no nav. */
export function VenueAccessUnavailablePage({
  reason,
}: {
  reason: VenueAccessUnavailableReason
}) {
  return (
    <div className="flex min-h-svh flex-col bg-paper">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-14 w-full max-w-(--size-page) items-center px-4 md:px-6">
          <span className="font-display text-xl leading-6 font-bold tracking-[-0.01em] text-ink">
            Naba-Lens
          </span>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto w-full max-w-(--size-page) flex-1 px-4 py-8 md:px-6 md:py-12"
      >
        <VenueAccessUnavailable reason={reason} />
      </main>
    </div>
  )
}
