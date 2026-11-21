import { BackLink } from "@/components/nabalens/back-link"
import { PageHeader } from "@/components/nabalens/page-header"
import { VenueBar } from "@/components/nabalens/venue-bar"
import { LinkButton } from "@/components/ui/link-button"

import {
  ADMIN_VENUE_TAB_LABELS,
  AdminVenueTabs,
  VenueAlbumPicks,
  VenueCoveragePicks,
  VenueReviewPicks,
  type AdminVenueTab,
  type VenueAlbumPick,
  type VenueCoveragePick,
  type VenueReviewPick,
} from "./admin-tabs"

/** Which tab of one venue a page sits in, and the view inside it. */
export type AdminVenueView =
  | { tab: "coverage"; pick?: VenueCoveragePick }
  | { tab: "review"; pick?: VenueReviewPick }
  | { tab: "album"; pick?: VenueAlbumPick }
  | { tab: Exclude<AdminVenueTab, "coverage" | "review" | "album"> }

export const ADMIN_VENUE_COPY = {
  venues: "Venues",
  changeVenue: "Change venue",
  role: (month?: string) =>
    month ? `You're an admin · ${month}` : "You're an admin",
} as const

/**
 * The top of every one-venue admin page (redesign R5, ia.md "Venues › one
 * venue"; handoff "The page frame and BackLink"): the VenueBar with Change
 * venue, the BackLink (Venues on a tab root, the parent tab on a detail
 * page), one display title, then the venue's tabs and the tab's pick.
 * A tab root is titled with the tab's name; a detail page with its record's.
 */
export function AdminVenueHeader({
  venueId,
  venueName,
  month,
  view,
  title,
  summary,
  actions,
  back,
  pendingReview,
}: {
  venueId: string
  venueName: string
  month?: string
  view: AdminVenueView
  /** A detail page's own title; tab roots take the tab's name. */
  title?: string
  summary?: React.ReactNode
  actions?: React.ReactNode
  /** A detail page's parent: its href and title. */
  back?: { href: string; label: string }
  pendingReview?: number
}) {
  // Detail pages keep the tabs, with their parent tab current, but no pick.
  const pick = back ? null : view.tab === "coverage" && view.pick ? (
    <VenueCoveragePicks venueId={venueId} active={view.pick} />
  ) : view.tab === "review" && view.pick ? (
    <VenueReviewPicks venueId={venueId} active={view.pick} />
  ) : view.tab === "album" && view.pick ? (
    <VenueAlbumPicks venueId={venueId} active={view.pick} />
  ) : null
  return (
    <div className="grid min-w-0 gap-3">
      <VenueBar
        name={venueName}
        role={ADMIN_VENUE_COPY.role(month)}
        className="rounded-card border"
        action={
          <LinkButton href="/admin/venues" variant="quiet" size="sm">
            {ADMIN_VENUE_COPY.changeVenue}
          </LinkButton>
        }
      />
      <div className="grid min-w-0 gap-1">
        <BackLink href={back?.href ?? "/admin/venues"} compact>
          {back?.label ?? ADMIN_VENUE_COPY.venues}
        </BackLink>
        <PageHeader
          title={back && title ? title : ADMIN_VENUE_TAB_LABELS[view.tab]}
          summary={summary}
          actions={actions}
          className="pb-0 md:pb-0"
        />
      </div>
      <AdminVenueTabs
        venueId={venueId}
        venueName={venueName}
        active={view.tab}
        pendingReview={pendingReview}
      />
      {pick}
    </div>
  )
}
