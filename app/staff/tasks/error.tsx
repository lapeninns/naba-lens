"use client"

import { ErrorState } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"

export default function TasksError({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto grid w-full max-w-(--size-feed) min-w-0 gap-(--gutter) px-(--page-gutter) py-4 md:px-0 md:py-8">
      <PageHeader title="Home" className="pb-1 md:pb-2" />
      <ErrorState
        title="We couldn't load your tasks"
        action={
          <Button variant="secondary" size="sm" onClick={() => retry()}>
            Try again
          </Button>
        }
      >
        Check your connection and try again. Photos you already sent are safe.
      </ErrorState>
    </div>
  )
}
