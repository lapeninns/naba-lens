"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"

export default function ManageChecklistError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-(--size-page) gap-(--gutter) px-(--page-gutter) py-4 md:gap-4 md:px-6 md:py-8">
      <h1 className="px-1 font-display text-page-title text-ink">Checklist</h1>
      <ErrorState
        title={ERROR_COPY.couldNotLoad("the checklist")}
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
