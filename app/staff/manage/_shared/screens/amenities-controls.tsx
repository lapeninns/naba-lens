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
} from "@/app/_knowledge/actions"
import { PlacesManager } from "@/components/nabalens/knowledge/places-manager"
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
}: {
  view: VenueAmenitiesView
  catalogue: CatalogueOption[] | null
  basePath: string
  toConfirm?: ToConfirmList | null
  toConfirmFailed?: boolean
}) {
  const venueId = view.venue.id
  return (
    <AmenitiesOverview
      view={view}
      catalogue={catalogue}
      basePath={basePath}
      toConfirm={toConfirm}
      toConfirmFailed={toConfirmFailed}
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
}: {
  detail: CheckDetail
  basePath: string
  canUpload?: boolean
  knowledge?: Extract<QuestionView, { inScope: true }> | null
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
