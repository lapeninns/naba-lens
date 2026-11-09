import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import {
  UI_TEXT,
  amenityHrefs,
  type AmenityFailure,
} from "@/lib/amenities/contract"
import { ROUTES } from "@/lib/auth/routes"
import {
  getCheck,
  getVenueAmenities,
  listCatalogue,
} from "@/lib/server/amenities"
import { isUuid } from "@/lib/server/coverage/validate"
import { knowledgeServices } from "@/lib/knowledge-client/services"

import { type ManageContext } from "../context"
import { ManageFrame, NotManagerPage } from "../frame"

import {
  AmenitiesOverviewControl,
  AmenityCheckControl,
} from "./amenities-controls"

/**
 * The page frame: /staff/manage and admin pages bring their own shell and
 * coverage tabs; the /manager workspace layout already has its shell and nav,
 * so its pages carry only the header.
 */
async function AmenitiesFrame({
  ctx,
  title,
  summary,
  pendingReview,
  children,
}: {
  ctx: ManageContext
  title: string
  summary?: React.ReactNode
  pendingReview?: number
  children: React.ReactNode
}) {
  if (ctx.mode === "workspace") {
    return (
      <div className="grid gap-6">
        <PageHeader
          scope={ctx.venue.name}
          venueScope
          title={title}
          summary={summary}
          className="pb-0 md:pb-0"
        />
        {children}
      </div>
    )
  }
  return (
    <ManageFrame
      ctx={ctx}
      section="amenities"
      title={title}
      summary={summary}
      pendingReview={pendingReview}
    >
      {children}
    </ManageFrame>
  )
}

/**
 * A refused read (grant revoked, moved venue) shows the plain refusal (the
 * workspace's is Venue access unavailable, on /manager); an
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
    if (ctx.mode === "workspace") redirect(ROUTES.managerHome)
    throw new Error(failure.message)
  }
  if (failure.code === "not_found" || failure.code === "invalid_input")
    notFound()
  if (failure.code === "unavailable" || failure.code === "needs_setup") {
    return (
      <AmenitiesFrame ctx={ctx} title={title}>
        <OfflineNotice />
        <Notice tone="negative" title="Amenities couldn't be loaded">
          {failure.message} Reload the page to try again.
        </Notice>
      </AmenitiesFrame>
    )
  }
  throw new Error(failure.message)
}

export async function AmenitiesScreen({ ctx }: { ctx: ManageContext }) {
  const [result, toConfirm] = await Promise.all([
    getVenueAmenities(ctx.actor, { venueId: ctx.venueId }),
    // Optional: a failed read leaves the checks without the To confirm group.
    knowledgeServices
      .listToConfirm(ctx.actor, { venueId: ctx.venueId })
      .catch(() => null),
  ])
  if (!result.ok) return amenityFailed(ctx, result, UI_TEXT.navTab)
  const view = result.view
  // The picker is only offered once Amenities are on; a failed catalogue read
  // leaves the checks usable and disables Add.
  const catalogue = view.enabled
    ? await listCatalogue(ctx.actor, { venueId: ctx.venueId })
    : null
  const venue = ctx.venue.name

  return (
    <AmenitiesFrame
      ctx={ctx}
      title={UI_TEXT.navTab}
      summary={`Questions guests ask about ${venue}, each answered with photo or video evidence. Separate from the checklist and photo targets.`}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <OfflineNotice />
      <AmenitiesOverviewControl
        view={view}
        catalogue={catalogue?.ok ? catalogue.options : null}
        basePath={ctx.basePath}
        toConfirm={toConfirm?.ok ? toConfirm.view : null}
      />
    </AmenitiesFrame>
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
  const [result, knowledge] = await Promise.all([
    getCheck(ctx.actor, { checkId }),
    knowledgeServices
      .getKnowledgeCheck(ctx.actor, { checkId, venueName: ctx.venue.name })
      .catch(() => null),
  ])
  if (!result.ok) return amenityFailed(ctx, result, "Amenity check")
  const detail = result.detail
  // An admin URL names its venue: a check from another venue is not here.
  if (detail.check.venueId !== ctx.venueId) notFound()
  const hrefs = amenityHrefs(ctx.basePath)

  return (
    <AmenitiesFrame
      ctx={ctx}
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
      <AmenityCheckControl
        detail={detail}
        basePath={ctx.basePath}
        canUpload={ctx.mode === "manager"}
        knowledge={
          // A failed knowledge read leaves the legacy screen: decisions need
          // the slot revision the server reads.
          knowledge?.ok && knowledge.view.inScope ? knowledge.view : null
        }
      />
    </AmenitiesFrame>
  )
}
