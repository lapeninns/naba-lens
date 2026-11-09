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
  decideFindingAction,
  resolveConflictAction,
} from "@/app/_knowledge/actions"
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
  QuestionView,
  ToConfirmList,
} from "@/lib/knowledge-client/contract"

export function AmenitiesOverviewControl({
  view,
  catalogue,
  basePath,
  toConfirm = null,
}: {
  view: VenueAmenitiesView
  catalogue: CatalogueOption[] | null
  basePath: string
  toConfirm?: ToConfirmList | null
}) {
  const venueId = view.venue.id
  return (
    <AmenitiesOverview
      view={view}
      catalogue={catalogue}
      basePath={basePath}
      toConfirm={toConfirm}
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
                resolveConflict: resolveConflictAction,
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
