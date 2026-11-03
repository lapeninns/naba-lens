"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ErrorState, ERROR_COPY } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"

export default function MenusError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-(--size-page) px-4 pt-6 md:px-6 md:py-8">
      <h1 className="pb-4 font-display text-page-title text-ink md:pb-5">
        Menus
      </h1>
      <ErrorState
        title={ERROR_COPY.couldNotLoad("menus")}
        action={
          <Button variant="secondary" size="sm" onClick={() => retry()}>
            <ArrowClockwiseIcon aria-hidden />
            {ERROR_COPY.tryAgain}
          </Button>
        }
      >
        {ERROR_COPY.checkConnection} No menu has changed.
      </ErrorState>
    </main>
  )
}
