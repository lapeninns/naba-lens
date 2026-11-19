"use client"

import { ErrorState } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"

/** The slot page couldn't be read: say so where it would be, with Try again. */
export default function AlbumSlotError({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto grid w-full max-w-feed min-w-0 gap-gutter px-page-gutter py-4 md:px-0 md:py-8">
      <ErrorState
        title="We couldn't load this slot"
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
