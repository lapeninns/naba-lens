"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import { catchError, type ErrorInfo } from "next/error"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { LIBRARY_COPY } from "./library-copy"

/** The captioned library grid's columns, so the placeholder holds its place. */
const GRID =
  "grid grid-cols-2 gap-(--gutter) md:grid-cols-[repeat(auto-fill,minmax(var(--size-tile-min),1fr))]"

/** The library grid while its first page loads (12 tiles, two desktop rows). */
export function LibraryGridSkeleton() {
  return (
    <SkeletonRegion label={LIBRARY_COPY.loading} className={GRID}>
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} shape="tile" />
      ))}
    </SkeletonRegion>
  )
}

export function LibraryRetryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="primary" onClick={onClick}>
      <ArrowClockwiseIcon aria-hidden />
      {ERROR_COPY.tryAgain}
    </Button>
  )
}

/**
 * The library failed to load: the notice takes the grid's place, while the
 * header and filters stay usable. Try again re-fetches the page.
 */
export function LibraryError({
  retry,
  digest,
}: {
  retry: () => void
  digest?: string
}) {
  return (
    <ErrorState
      title={LIBRARY_COPY.couldNotLoad}
      action={<LibraryRetryButton onClick={retry} />}
      detail={digest ? `Request ID ${digest}` : undefined}
    />
  )
}

function LibraryErrorFallback(_props: object, { error, retry }: ErrorInfo) {
  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined
  return <LibraryError retry={retry} digest={digest} />
}

export const LibraryErrorBoundary = catchError(LibraryErrorFallback)
