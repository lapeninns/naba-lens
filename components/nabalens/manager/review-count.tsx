"use client"

import * as React from "react"

import { ALBUM_REVIEW_COPY } from "@/components/nabalens/album/review/copy"

type ReviewCount = {
  /** Photos waiting for the caller's decision; undefined when it could not be read. */
  count: number | undefined
  /** Moves the count by `delta` (e.g. -1 when a decision leaves the queue). */
  settle(delta: number): void
}

const NO_PROVIDER: ReviewCount = { count: undefined, settle() {} }

const ReviewCountContext = React.createContext<ReviewCount>(NO_PROVIDER)

/**
 * Holds the Review badge count of the manager workspace. The layout seeds it
 * from the overview read; Review moves it as decisions land, and the next
 * server render (navigation or refresh) seeds it again.
 */
export function ReviewCountProvider({
  count,
  children,
}: {
  count: number | undefined
  children: React.ReactNode
}) {
  const [seed, setSeed] = React.useState(count)
  const [current, setCurrent] = React.useState(count)
  if (seed !== count) {
    setSeed(count)
    setCurrent(count)
  }
  const settle = React.useCallback((delta: number) => {
    setCurrent((value) =>
      value === undefined ? value : Math.max(0, value + delta)
    )
  }, [])
  const value = React.useMemo(
    () => ({ count: current, settle }),
    [current, settle]
  )
  return (
    <ReviewCountContext.Provider value={value}>
      {children}
    </ReviewCountContext.Provider>
  )
}

/** The Review badge count; without a provider (the admin page) `settle` does nothing. */
export function useReviewCount(): ReviewCount {
  return React.useContext(ReviewCountContext)
}

/**
 * Review's one title on every tab, "{n} photos to review" (redesign R4,
 * ia.md), from the workspace's count so it moves as decisions land. Without
 * a count it says what the page is.
 */
export function ReviewCountTitle({ fallback }: { fallback: string }) {
  const { count } = useReviewCount()
  // The wording is imported here, not passed in: a Server Component page
  // cannot hand a function to this Client Component.
  return <>{count === undefined ? fallback : ALBUM_REVIEW_COPY.title(count)}</>
}
