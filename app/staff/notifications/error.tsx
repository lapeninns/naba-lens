"use client"

import { ErrorState } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"

export default function NoticesError({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto grid w-full max-w-feed min-w-0 gap-gutter px-page-gutter py-4 md:px-0 md:py-8">
      <ErrorState
        title="We couldn't load your notices"
        action={
          <Button variant="secondary" size="sm" onClick={() => retry()}>
            Try again
          </Button>
        }
      >
        Check your connection and try again.
      </ErrorState>
    </div>
  )
}
