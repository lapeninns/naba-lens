"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"

export default function ManageError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-(--size-page) gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="font-display text-page-title text-ink">Manage</h1>
      <ErrorState
        title={ERROR_COPY.couldNotLoad("venue coverage")}
        action={
          <Button variant="secondary" size="sm" onClick={() => retry()}>
            <ArrowClockwiseIcon aria-hidden />
            {ERROR_COPY.tryAgain}
          </Button>
        }
      />
    </main>
  )
}
