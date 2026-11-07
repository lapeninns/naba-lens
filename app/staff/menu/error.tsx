"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { OUR_MENU_COPY } from "@/components/nabalens/menu-photos/copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"

export default function OurMenuError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-(--size-page) flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        scope={OUR_MENU_COPY.title}
        title={OUR_MENU_COPY.title}
        className="pb-0 md:pb-0"
      />
      <ErrorState
        title={OUR_MENU_COPY.unavailableTitle}
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
