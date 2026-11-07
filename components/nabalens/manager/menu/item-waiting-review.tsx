"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { ReviewList } from "@/components/nabalens/manager/review"
import type { Page, QueueCard } from "@/lib/server/menu-photos/types"

/**
 * The item page's waiting photos as a Review list. A decision here changes
 * the item (its menu photo, status and revision), so the page refreshes its
 * detail once the list has updated in place.
 */
export function ItemWaitingReview({
  itemId,
  initial,
  venueName,
  now,
}: {
  itemId: string
  initial: Page<QueueCard>
  venueName: string
  /** Render time (ISO), so waiting ages match between server and browser. */
  now: string
}) {
  const router = useRouter()
  const onDecided = React.useCallback(() => router.refresh(), [router])
  return (
    <ReviewList
      initial={initial}
      view={{
        status: "pending",
        sectionId: null,
        contributorId: null,
        itemId,
      }}
      scope={{ kind: "manager" }}
      venueName={venueName}
      now={now}
      showItemLinks={false}
      onDecided={onDecided}
    />
  )
}
