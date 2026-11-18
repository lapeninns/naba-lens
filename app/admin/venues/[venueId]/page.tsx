import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { CoverageSection } from "@/components/nabalens/coverage"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import {
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

import {
  ReviewerForm,
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
      <ul
        className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
        data-testid="setup-checklist"
      >
        {venue.setup.items.map((item) => (
          <li key={item.key}>
            <Link
              href={setupHref(item, venue.id)}
              data-testid={`setup-${item.key}`}
              data-done={item.done}
              className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 focus-ring-inset outline-none hover:bg-surface-2"
            >
              <span className="grid min-w-0 gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-label text-ink">
                    {SETUP_TITLES[item.key]}
                  </span>
                  <StatusChip
                    state={item.done ? "setup_in_place" : "needs_setup"}
                  />
                </span>
                <span className="text-meta text-ink-muted">
                  {setupDetail(item)}
                </span>
              </span>
              <CaretRightIcon aria-hidden className="size-5 text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
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

  return (
    <AppShell variant="admin" active="venues" userName={profile.displayName}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <PageHeader
            scope={[
              <Link
                key="venues"
                href="/admin/venues"
                className="underline decoration-1 underline-offset-4 focus-ring outline-none"
              >
                Venues
              </Link>,
              venue.locality ?? undefined,
            ]}
            title={venue.name}
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
            className="pb-0 md:pb-0"
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

        <SetupChecklist venue={venue} />

        {venue.active ? (
          <CoverageSection id="reviewers" title="Reviewers">
            <p className="px-1 text-body text-ink-muted">
              People who review here today: the venue&apos;s managers and the
              group admins. To add one, make them a manager in People.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <ReviewerForm
                venueId={venue.id}
                responsibility="main"
                current={venue.reviewers.main}
                candidates={venue.candidates}
              />
              <ReviewerForm
                venueId={venue.id}
                responsibility="backup"
                current={venue.reviewers.backup}
                candidates={venue.candidates}
              />
            </div>
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

        <CoverageSection id="details" title="Name and location">
          <div className="rounded-card border border-line bg-surface p-4">
            <VenueDetailsForm venue={venue} />
          </div>
        </CoverageSection>

        <CoverageSection id="menus" title="Menus">
          <Link
            href={`/admin/menus/${venue.id}`}
            data-testid="venue-menus-link"
            className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 focus-ring-inset outline-none hover:bg-surface-2"
          >
            <span className="grid gap-0.5">
              <span className="text-label text-ink">
                {inventory?.menuTitle ?? "No active menu"}
              </span>
              <span className="text-meta text-ink-muted">
                Menu versions, imports and schedules for this venue.
              </span>
            </span>
            <CaretRightIcon aria-hidden className="size-5 text-ink-muted" />
          </Link>
        </CoverageSection>

        {venue.active ? (
          <CoverageSection id="collect" title="What this venue collects">
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
                The venue&apos;s scope couldn&apos;t be loaded. Reload the page.
              </Notice>
            )}
            <TemplateForm venueId={venue.id} otherVenues={otherVenues} />
          </CoverageSection>
        ) : null}

        <CoverageSection id="status" title="Status">
          <div className="rounded-card border border-line bg-surface p-4">
            <StatusForm venue={venue} />
          </div>
        </CoverageSection>
      </div>
    </AppShell>
  )
}
