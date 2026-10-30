"use client"

import { SpinnerGapIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type LoadMoreButtonProps = {
  hasMore: boolean
  loading?: boolean
  error?: string | null
  onLoadMore: () => void
  /** Optional count already shown, e.g. "48 shown". */
  shownCount?: number
  className?: string
}

/** Cursor pager: the page owns the cursor and calls the server for the next page. */
export function LoadMoreButton({
  hasMore,
  loading = false,
  error,
  onLoadMore,
  shownCount,
  className,
}: LoadMoreButtonProps) {
  if (!hasMore && !error) {
    return shownCount ? (
      <p
        className={cn(
          "py-4 text-center text-sm text-muted-foreground",
          className
        )}
      >
        All {shownCount} shown
      </p>
    ) : null
  }
  return (
    <div className={cn("flex flex-col items-center gap-2 py-4", className)}>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <Button
        variant="outline"
        size="touch"
        onClick={onLoadMore}
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? (
          <SpinnerGapIcon
            data-icon="inline-start"
            className="motion-safe:animate-spin"
            aria-hidden
          />
        ) : null}
        {loading ? "Loading…" : error ? "Try again" : "Load more"}
      </Button>
    </div>
  )
}
