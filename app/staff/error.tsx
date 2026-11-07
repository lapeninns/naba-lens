"use client"

import { WarningIcon } from "@phosphor-icons/react"

import { IconDisc } from "@/components/nabalens/common-room"
import { Button } from "@/components/ui/button"

export default function StaffError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-(--page-gutter) py-6">
      <div className="grid justify-items-center gap-3 rounded-card bg-surface px-5 py-8 text-center shadow-card">
        <IconDisc tone="warn">
          <WarningIcon />
        </IconDisc>
        <h1 className="font-display text-section-title text-ink">
          Your portfolio could not load
        </h1>
        <p className="text-body text-ink-muted">
          Check your connection and try again.
        </p>
        <Button size="touch" className="w-full" onClick={() => retry()}>
          Try again
        </Button>
      </div>
    </main>
  )
}
