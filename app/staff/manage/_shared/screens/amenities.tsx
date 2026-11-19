import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { buttonVariants } from "@/components/ui/button"
import {
  UI_TEXT,
  amenityHrefs,
  type AmenityFailure,
} from "@/lib/amenities/contract"
import {
  getCheck,
  getVenueAmenities,
  listCatalogue,
} from "@/lib/server/amenities"
import { isUuid } from "@/lib/server/coverage/validate"

import { type ManageContext } from "../context"
import { ManageFrame, NotManagerPage } from "../frame"

import {
  AmenitiesOverviewControl,
  AmenityCheckControl,
} from "./amenities-controls"

/**
 * A refused read (grant revoked, moved venue) shows the plain refusal; an
 * unknown check is a 404; a service that is down is said on the page, so the
 * tabs stay usable. Anything else goes to the segment error boundary.
 */
function amenityFailed(
  ctx: ManageContext,
  failure: AmenityFailure,
  title: string
) {
  if (failure.code === "not_permitted" || failure.code === "wrong_venue") {
    if (ctx.mode === "manager")
      return <NotManagerPage viewerName={ctx.viewerName} />
    throw new Error(failure.message)
  }
  if (failure.code === "not_found" || failure.code === "invalid_input")
    notFound()
  if (failure.code === "unavailable" || failure.code === "needs_setup") {
    return (
      <ManageFrame ctx={ctx} section="amenities" title={title}>
        <OfflineNotice />
        <Notice tone="negative" title="Amenities couldn't be loaded">
          {failure.message} Reload the page to try again.
        </Notice>
      </ManageFrame>
    )
  }
  throw new Error(failure.message)
}

export async function AmenitiesScreen({ ctx }: { ctx: ManageContext }) {
  const result = await getVenueAmenities(ctx.actor, { venueId: ctx.venueId })
  if (!result.ok) return amenityFailed(ctx, result, UI_TEXT.navTab)
  const view = result.view
  // The picker is only offered once Amenities are on; a failed catalogue read
  // leaves the checks usable and disables Add.
  const catalogue = view.enabled
    ? await listCatalogue(ctx.actor, { venueId: ctx.venueId })
    : null
  const venue = ctx.venue.name

  return (
    <ManageFrame
      ctx={ctx}
      section="amenities"
      title={UI_TEXT.navTab}
      summary={`Questions guests ask about ${venue}, each answered with photo or video evidence. Separate from the checklist and photo targets.`}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <OfflineNotice />
      <AmenitiesOverviewControl
        view={view}
        catalogue={catalogue?.ok ? catalogue.options : null}
        basePath={ctx.basePath}
      />
    </ManageFrame>
  )
}

export async function AmenityCheckScreen({
  ctx,
  checkId,
}: {
  ctx: ManageContext
  checkId: string
}) {
  if (!isUuid(checkId)) notFound()
  const result = await getCheck(ctx.actor, { checkId })
  if (!result.ok) return amenityFailed(ctx, result, "Amenity check")
  const detail = result.detail
  // An admin URL names its venue: a check from another venue is not here.
  if (detail.check.venueId !== ctx.venueId) notFound()
  const hrefs = amenityHrefs(ctx.basePath)

  return (
    <ManageFrame
      ctx={ctx}
      section="amenities"
      title={detail.check.entry.question}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <OfflineNotice />
      <div>
        <Link
          href={hrefs.list}
          className={buttonVariants({ variant: "link", size: "sm" })}
        >
          <ArrowLeftIcon aria-hidden />
          All amenities
        </Link>
      </div>
      <AmenityCheckControl detail={detail} basePath={ctx.basePath} />
    </ManageFrame>
  )
}
