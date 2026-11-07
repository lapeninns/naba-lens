"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ErrorState, ERROR_COPY } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"

export default function MenusError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-(--size-page) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <h1 className="px-1 pb-3 font-display text-page-title text-ink md:px-0 md:pb-5">
        Menus
      </h1>
      <ErrorState
        title={ERROR_COPY.couldNotLoad("menus")}
        action={
          <Button variant="primary" onClick={() => retry()}>
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
