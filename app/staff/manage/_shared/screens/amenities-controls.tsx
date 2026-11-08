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
  AmenitiesOverview,
  AmenityCheckDetail,
} from "@/components/nabalens/amenities/manage"
import type {
  CatalogueOption,
  CheckDetail,
  VenueAmenitiesView,
} from "@/lib/amenities/contract"

export function AmenitiesOverviewControl({
  view,
  catalogue,
  basePath,
}: {
  view: VenueAmenitiesView
  catalogue: CatalogueOption[] | null
  basePath: string
}) {
  const venueId = view.venue.id
  return (
    <AmenitiesOverview
      view={view}
      catalogue={catalogue}
      basePath={basePath}
      handlers={{
        enable: () => enableAmenitiesAction({ venueId }),
        addChecks: (keys) => addChecksAction({ venueId, keys }),
        restore: (input) => restoreCheckAction(input),
      }}
    />
  )
}

export function AmenityCheckControl({
  detail,
  basePath,
  canUpload,
}: {
  detail: CheckDetail
  basePath: string
  canUpload?: boolean
}) {
  return (
    <AmenityCheckDetail
      key={detail.check.id}
      detail={detail}
      basePath={basePath}
      canUpload={canUpload}
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
