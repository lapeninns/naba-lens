"use client"

// Binds the Our menu Server Actions to the presentational components. Every
// action re-authorises and re-checks the venue on the server; `venueId` here
// only names the venue the page shows (staff and managers: their own, admins:
// chosen).

import { useRouter } from "next/navigation"

import {
  loadItemPhotoCandidatesAction,
  loadItemPhotoSelfReviewsAction,
  loadOurMenuItemsAction,
  reviewItemPhotoAction,
  setPrimaryItemPhotoAction,
  withdrawItemPhotoAction,
} from "@/app/_coverage/actions"
import {
  ItemPhotoReview,
  ItemPhotoSelfReviewList,
  OurMenuList,
  type OurMenuFilter,
} from "@/components/nabalens/menu-photos"
import type {
  ItemPhotoCandidate,
  ItemPhotoSelfReviewView,
  OurMenuItem,
  OurMenuSection,
  Page,
  PeriodKey,
} from "@/lib/server/coverage/types"

/** `?item=<id>` on the reviewer screen: one dish's photos. */
export function itemReviewHref(basePath: string, itemId: string): string {
  return `${basePath}?item=${encodeURIComponent(itemId)}`
}

export function OurMenuListControl({
  initial,
  sections,
  canAdd,
  filter,
  venueId,
  reviewBasePath,
}: {
  initial: Page<OurMenuItem>
  sections: OurMenuSection[]
  canAdd: boolean
  filter: OurMenuFilter
  /** Admins name the venue; staff and managers read their own. */
  venueId?: string
  /** Reviewers: each dish links to its photos under this path. */
  reviewBasePath?: string
}) {
  return (
    <OurMenuList
      initial={initial}
      sections={sections}
      canAdd={canAdd}
      reviewHref={
        reviewBasePath
          ? (itemId) => itemReviewHref(reviewBasePath, itemId)
          : undefined
      }
      onLoadMore={(cursor) =>
        loadOurMenuItemsAction({
          ...(venueId ? { venueId } : {}),
          ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
          gapsOnly: filter.gapsOnly,
          ...(filter.query ? { query: filter.query } : {}),
          cursor,
        })
      }
    />
  )
}

export function ItemPhotoReviewControl({
  initial,
  venueId,
  venueName,
  now,
  itemId,
  basePath,
  emptyTitle,
}: {
  initial: Page<ItemPhotoCandidate>
  venueId: string
  venueName: string
  now: string
  /** One dish's photos, decided ones included; otherwise the waiting queue. */
  itemId?: string
  /** The queue links each dish to its photos under this path. */
  basePath?: string
  emptyTitle?: string
}) {
  const router = useRouter()
  return (
    <ItemPhotoReview
      initial={initial}
      venueName={venueName}
      now={now}
      emptyTitle={emptyTitle}
      handlers={{
        review: (input) => reviewItemPhotoAction(input),
        withdraw: (input) => withdrawItemPhotoAction(input),
        setPrimary: (input) => setPrimaryItemPhotoAction(input),
      }}
      onStale={() => router.refresh()}
      itemHref={
        !itemId && basePath ? (id) => itemReviewHref(basePath, id) : undefined
      }
      onLoadMore={(cursor) =>
        loadItemPhotoCandidatesAction({
          venueId,
          ...(itemId ? { itemId, includeReviewed: true } : {}),
          cursor,
        })
      }
    />
  )
}

export function ItemPhotoSelfReviewsControl({
  initial,
  period,
  venueId,
}: {
  initial: Page<ItemPhotoSelfReviewView>
  period?: PeriodKey
  venueId?: string
}) {
  return (
    <ItemPhotoSelfReviewList
      initial={initial}
      onLoadMore={(cursor) =>
        loadItemPhotoSelfReviewsAction({ venueId, period, cursor })
      }
    />
  )
}
