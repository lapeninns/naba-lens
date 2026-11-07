"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { OUR_MENU_COPY } from "@/components/nabalens/menu-photos/copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"

export default function OurMenuError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-(--size-page) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <PageHeader
        scope={OUR_MENU_COPY.title}
        title={OUR_MENU_COPY.title}
        className="pb-1 md:pb-1"
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
