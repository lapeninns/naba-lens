"use client"

import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react"

import { IconDisc } from "@/components/nabalens/common-room"
import { Button } from "@/components/ui/button"

export default function WorkProfileError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-(--size-feed) flex-col justify-center px-(--page-gutter) py-6">
      <div className="grid justify-items-center gap-3 rounded-card bg-surface px-5 py-8 text-center shadow-card">
        <IconDisc tone="warn">
          <WarningIcon />
        </IconDisc>
        <h1 className="font-display text-section-title text-ink">
          Your work details could not load
        </h1>
        <p className="text-body text-ink-muted">
          Check your connection and try again.
        </p>
        <Button size="touch" className="mt-2 w-full" onClick={() => retry()}>
          <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
          Try again
        </Button>
      </div>
    </main>
  )
}
