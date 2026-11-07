"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"

export default function CommunityError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-0 md:py-8">
      <PageHeader scope="All venues" title="Photos" className="pb-1 md:pb-1" />
      <ErrorState
        title={ERROR_COPY.couldNotLoad("photos")}
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
