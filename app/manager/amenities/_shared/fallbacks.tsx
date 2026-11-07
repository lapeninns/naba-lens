"use client"

import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

// The /staff/manage fallbacks bring their own <main> or admin shell; inside
// the workspace the layout's shell and nav stay, so these render the body only.

/** Loading state for the amenity list and check pages. */
export function AmenitiesWorkspaceLoading({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="grid gap-5">
      <div className="grid gap-2">
        <Skeleton shape="title" className="w-[40%]" />
        <Skeleton shape="line" className="w-[70%]" />
      </div>
      {["w-3/5", "w-[52%]", "w-[66%]"].map((wide) => (
        <div key={wide} className="grid gap-2">
          <Skeleton shape="line" className={wide} />
          <Skeleton shape="line" className="w-[35%]" />
        </div>
      ))}
    </SkeletonRegion>
  )
}

/** Segment error boundary body: what failed and "Try again". */
export function AmenitiesWorkspaceError({
  title,
  what,
  retry,
}: {
  title: string
  what: string
  retry: () => void
}) {
  const router = useRouter()
  return (
    <div className="grid gap-5">
      <h1 className="font-display text-page-title text-ink">{title}</h1>
      <ErrorState
        title={ERROR_COPY.couldNotLoad(what)}
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              retry()
              router.refresh()
            }}
          >
            <ArrowClockwiseIcon aria-hidden />
            {ERROR_COPY.tryAgain}
          </Button>
        }
      />
    </div>
  )
}
