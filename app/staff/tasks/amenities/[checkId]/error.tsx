"use client"

import { ErrorState } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"
import { UI_TEXT } from "@/lib/amenities/contract"

export default function AmenityCaptureError({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Amenity check" />
      <ErrorState
        title="We couldn't load this amenity check"
        action={
          <Button variant="secondary" size="sm" onClick={() => retry()}>
            {UI_TEXT.retry}
          </Button>
        }
      >
        Check your connection and try again. A draft you started on this device
        is kept.
      </ErrorState>
    </div>
  )
}
