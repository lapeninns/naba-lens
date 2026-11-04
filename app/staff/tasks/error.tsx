"use client"

import { ErrorState } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"

export default function TasksError({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Home" />
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
