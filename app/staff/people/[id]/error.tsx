"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"

import { PROFILE_COPY } from "../people"

export default function ColleagueError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <PageHeader
        scope={[...PROFILE_COPY.scope]}
        title={<span className="sr-only">{PROFILE_COPY.srTitle}</span>}
        className="pb-0 md:pb-0"
      />
      <ErrorState
        title={ERROR_COPY.couldNotLoad("this profile")}
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
