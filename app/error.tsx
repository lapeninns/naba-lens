"use client"

import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react"

import { IconDisc } from "@/components/nabalens/common-room/icon-disc"
import { Button } from "@/components/ui/button"

/**
 * Fallback for errors a segment's own error.tsx cannot catch, chiefly the
 * /admin and /staff layout role gates: a segment's error.tsx does not wrap its
 * own layout. A profile read that fails there (database trouble) shows this
 * instead of Next's bare 500 document. It never grants access: `retry`
 * re-requests the page, which checks the account again.
 */
export default function AppError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-(--size-feed) flex-col items-center justify-center gap-3 bg-bg px-(--page-gutter) py-6 text-center text-ink">
      <IconDisc tone="warn">
        <WarningIcon />
      </IconDisc>
      <h1 className="font-display text-page-title text-balance">
        This page could not load
      </h1>
      <p className="text-body text-ink-muted">
        Check your connection and try again.
      </p>
      <Button size="touch" className="mt-2 min-w-55" onClick={() => retry()}>
        <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
        Try again
      </Button>
    </main>
  )
}
