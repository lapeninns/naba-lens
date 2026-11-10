"use client"

// Binds the amenity Server Actions to the presentational components. Every
// action re-authorises and re-checks the venue on the server; `venueId` only
// names the venue the page shows (managers: their own, admins: chosen).

import {
  addChecksAction,
  archiveCheckAction,
  assignCheckAction,
  enableAmenitiesAction,
  reopenCheckAction,
  restoreCheckAction,
  setCheckNotesAction,
} from "@/app/_amenities/actions"
import {
  addPlaceAction,
  decideFindingAction,
  resolveConflictAction,
  retirePlaceAction,
  addScheduleExceptionAction,
  slotEventsAction,
  slotHistoryAction,
  withdrawAnswerAction,
} from "@/app/_knowledge/actions"
import { PlacesManager } from "@/components/nabalens/knowledge/places-manager"
import type { PolicyContext } from "@/components/nabalens/knowledge/policy-detail"
import type { UpcomingRead } from "@/components/nabalens/knowledge/schedule-section"
import type {
  LegacyNarrativeItem,
  RecheckTask,
  SlotEventView,
} from "@/lib/knowledge-client/contract"
import {
  AmenitiesOverview,
  AmenityCheckDetail,
} from "@/components/nabalens/amenities/manage"
import type {
  CatalogueOption,
  CheckDetail,
  VenueAmenitiesView,
} from "@/lib/amenities/contract"
import type {
  Place,
  QuestionView,
  ToConfirmList,
} from "@/lib/knowledge-client/contract"

export function AmenitiesOverviewControl({
  view,
  catalogue,
  basePath,
  toConfirm = null,
  toConfirmFailed = false,
  rechecks,
}: {
  view: VenueAmenitiesView
  catalogue: CatalogueOption[] | null
  basePath: string
  toConfirm?: ToConfirmList | null
  toConfirmFailed?: boolean
  /** A41: the venue's open rechecks; null when unreadable. */
  rechecks?: RecheckTask[] | null
}) {
  const venueId = view.venue.id
  return (
    <AmenitiesOverview
      view={view}
      catalogue={catalogue}
      basePath={basePath}
      toConfirm={toConfirm}
      toConfirmFailed={toConfirmFailed}
      rechecks={rechecks}
      handlers={{
        enable: () => enableAmenitiesAction({ venueId }),
        addChecks: (keys, idempotencyKey) =>
          addChecksAction({ venueId, keys, idempotencyKey }),
        restore: (input) => restoreCheckAction(input),
      }}
    />
  )
}

export function AmenityCheckControl({
  detail,
  basePath,
  canUpload,
  knowledge = null,
  policy = null,
  schedule = null,
  rechecks = null,
  oldFacts,
  corrections = null,
}: {
  detail: CheckDetail
  basePath: string
  canUpload?: boolean
  knowledge?: Extract<QuestionView, { inScope: true }> | null
  /** A policy question (B03-c): its places and value lists. */
  policy?: PolicyContext | null
  /** B03-g: who may correct, withdraw and read history, and its first page. */
  corrections?: {
    canCorrect: boolean
    canWithdraw: boolean
    canReadHistory: boolean
    /** A35: may state a policy here. */
    canStatePolicy?: boolean
    events: { items: SlotEventView[]; nextCursor: string | null } | null
    today: string
  } | null
  /** B03-f: the venue's old facts; null unreadable, undefined not read. */
  oldFacts?: LegacyNarrativeItem[] | null
  /** B03-e: the check's open rechecks; null when unreadable. */
  rechecks?: { count: number; tasks: RecheckTask[] } | null
  /** A schedule in use (B03-d): what Upcoming read. */
  schedule?: {
    read: UpcomingRead
    timezone: string
    lastDay: string | null
    today: string
  } | null
}) {
  return (
    <AmenityCheckDetail
      key={detail.check.id}
      detail={detail}
      basePath={basePath}
      canUpload={canUpload}
      knowledge={
        knowledge
          ? {
              view: knowledge,
              policy,
              rechecks,
              oldFacts,
              corrections: corrections
                ? {
                    ...corrections,
                    withdraw: withdrawAnswerAction,
                    loadOlder: slotEventsAction,
                    loadAt: slotHistoryAction,
                  }
                : null,
              schedule: schedule
                ? { ...schedule, addException: addScheduleExceptionAction }
                : null,
              handlers: {
                decide: decideFindingAction,
                onResolveConflict: resolveConflictAction,
              },
            }
          : null
      }
      handlers={{
        assign: (input) => assignCheckAction(input),
        setNotes: (input) => setCheckNotesAction(input),
        archive: (input) => archiveCheckAction(input),
        restore: (input) => restoreCheckAction(input),
        reopen: (input) => reopenCheckAction(input),
      }}
    />
  )
}

export function PlacesControl({
  venueId,
  venueName,
  places,
}: {
  venueId: string
  venueName: string
  places: Place[]
}) {
  return (
    <PlacesManager
      venueId={venueId}
      venueName={venueName}
      places={places}
      handlers={{
        add: (input) => addPlaceAction(input),
        retire: (input) => retirePlaceAction(input),
      }}
    />
  )
}
