import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { Row, RowList } from "@/components/nabalens/common-room/row"
import { CoverageSection } from "@/components/nabalens/coverage"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import {
  OPERATING_STATUSES,
  operatingStatusChip,
  SETUP_TITLES,
  setupDetail,
  setupHref,
  type AdminVenueDetail,
} from "@/lib/admin/venues"
import { getAdminVenue, listAdminVenues } from "@/lib/server/admin/venues"
import { getCoverageActor } from "@/lib/server/coverage"
import { getVenueScope } from "@/lib/server/menus/local"
import { getReviewSettings } from "@/lib/server/review/single-reviewer"

import { AdminVenueHeader } from "../../_components/admin-venue-header"
import {
  ReviewersForm,
  ScopeForm,
  StatusForm,
  TemplateForm,
  VenueDetailsForm,
} from "../venue-forms"
import { SingleReviewerSetting } from "./single-reviewer"

export const metadata: Metadata = { title: "Venue" }

function SetupChecklist({ venue }: { venue: AdminVenueDetail }) {
  return (
    <CoverageSection
      id="setup"
      title="Setup checklist"
      count={`${venue.setup.done} of ${venue.setup.total} in place`}
    >
      {/* v2 SCREENS A2: the setup checklist as ListRows with StatusChips. */}
      <div data-testid="setup-checklist" className="contents">
        <RowList list>
          {venue.setup.items.map((item) => (
            <Row
              key={item.key}
              href={setupHref(item, venue.id)}
              data-testid={`setup-${item.key}`}
              data-done={item.done}
              title={SETUP_TITLES[item.key]}
              subtitle={setupDetail(item)}
              chips={
                <StatusChip
                  state={item.done ? "setup_in_place" : "needs_setup"}
                />
              }
            />
          ))}
        </RowList>
      </div>
    </CoverageSection>
  )
}

/**
 * One venue (spec §8 A2): setup checklist first (what is missing), then its
 * reviewers, details, menus, what it collects (templates and scope) and its
 * operating status. Admins only; every form re-checks in the database.
 */
export default async function AdminVenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ venueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const { venueId } = await params
  const created = (await searchParams).created === "1"
  const read = await getAdminVenue(auth.actor, venueId)
  if (!read.ok) {
    if (read.code === "not_found") notFound()
    throw new Error(read.message)
  }
  const venue = read.venue
  const [scope, venues, review] = await Promise.all([
    getVenueScope(auth.actor, venue.id),
    listAdminVenues(auth.actor, true),
    getReviewSettings(auth.actor, venue.id),
  ])
  const accommodation = scope.ok
    ? scope.scope.find((s) => s.key === "accommodation")
    : undefined
  const otherVenues = venues.ok
    ? venues.venues
        .filter((v) => v.id !== venue.id)
        .map((v) => ({ id: v.id, name: v.name }))
    : []
  const inventory = venue.setup.items.find((i) => i.key === "inventory")
  const statusLabel = OPERATING_STATUSES.find(
    (s) => s.value === venue.operatingStatus
  )?.label

  return (
    <AppShell variant="admin" active="venues" userName={profile.displayName}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          {/* Venues › one venue › Setup (redesign R5, ia.md): the venue is
              named in the VenueBar; the title is the tab's. */}
          <AdminVenueHeader
            venueId={venue.id}
            venueName={
              venue.locality ? `${venue.name}, ${venue.locality}` : venue.name
            }
            view={{ tab: "setup" }}
            summary={
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip
                  state={operatingStatusChip(venue.operatingStatus)}
                />
                <span className="text-meta text-ink-muted">
                  {venue.timezone}
                </span>
              </div>
            }
            actions={
              <Link
                href={`/admin/activity?venue=${venue.id}`}
                className={buttonVariants({ variant: "secondary" })}
              >
                Activity
              </Link>
            }
          />
          <OfflineNotice />
          {created ? (
            <Notice tone="positive" role="status">
              {venue.name} is added. Work through the checklist below to set it
              up.
            </Notice>
          ) : null}
          {!venue.active ? (
            <Notice tone="attention" title="Archived">
              This venue is closed and archived. Its photos, decisions and
              history are kept; only admins can open it. Reopen it under Status.
            </Notice>
          ) : null}
        </div>

        {/* Second handoff, venue Setup: the checklist is the page, with the
            reference forms folded shut under it; Reviewers stays open beside
            it because that is the step most often missing. */}
        <div className="grid min-w-0 items-start gap-8 md:grid-cols-2">
          <div className="grid min-w-0 gap-4">
            <SetupChecklist venue={venue} />

            <CoverageSection
              id="details"
              title="Name and location"
              count={[venue.locality, venue.timezone]
                .filter(Boolean)
                .join(" · ")}
              collapsed
            >
              <VenueDetailsForm venue={venue} />
            </CoverageSection>

            <CoverageSection
              id="menus"
              title="Menus"
              count={inventory?.menuTitle ?? "No active menu"}
              collapsed
            >
              <Row
                href={`/admin/menus/${venue.id}`}
                data-testid="venue-menus-link"
                title={inventory?.menuTitle ?? "No active menu"}
                subtitle="Menu versions, imports and schedules for this venue."
              />
            </CoverageSection>

            {venue.active ? (
              <CoverageSection
                id="collect"
                title="What this venue collects"
                count={
                  accommodation
                    ? accommodation.applicable
                      ? "Accommodation"
                      : "No accommodation"
                    : undefined
                }
                collapsed
              >
                {accommodation ? (
                  <ScopeForm
                    venueId={venue.id}
                    applicable={accommodation.applicable}
                    decided={accommodation.decided}
                    revision={accommodation.revision}
                    reason={accommodation.reason}
                  />
                ) : (
                  <Notice tone="negative" role="alert">
                    The venue&apos;s scope couldn&apos;t be loaded. Reload the
                    page.
                  </Notice>
                )}
                <TemplateForm venueId={venue.id} otherVenues={otherVenues} />
              </CoverageSection>
            ) : null}

            <CoverageSection
              id="status"
              title="Status"
              count={statusLabel}
              collapsed
            >
              <StatusForm venue={venue} />
            </CoverageSection>
          </div>

          {venue.active ? (
            <CoverageSection id="reviewers" title="Reviewers">
              <p className="px-1 text-body text-ink-muted">
                People who review here today: the venue&apos;s managers and the
                group admins. To add one, make them a manager in People.
              </p>
              <ReviewersForm
                venueId={venue.id}
                main={venue.reviewers.main}
                backup={venue.reviewers.backup}
                candidates={venue.candidates}
              />
              {/* FA-9 single-reviewer venue (S3-R1 K6). */}
              {review.ok ? (
                <SingleReviewerSetting
                  venueId={venue.id}
                  settings={review.settings}
                />
              ) : (
                <Notice tone="negative" role="alert">
                  The review setting couldn&apos;t be loaded. Reload the page.
                </Notice>
              )}
            </CoverageSection>
          ) : null}
        </div>
      </div>
    </AppShell>
  )
}
