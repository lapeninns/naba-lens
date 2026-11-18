import type { Metadata } from "next"
import Link from "next/link"
import { CaretRightIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { EmptyState } from "@/components/nabalens/empty-state"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import {
  operatingStatusChip,
  setupBlocked,
  type AdminVenue,
} from "@/lib/admin/venues"
import { listAdminVenues } from "@/lib/server/admin/venues"
import { getCoverageActor } from "@/lib/server/coverage"

export const metadata: Metadata = { title: "Venues" }

export const VENUES_COPY = {
  title: "Venues",
  scope: "All venues",
  summary:
    "Each venue's name, location, timezone, status, reviewers and setup. Venues with setup still to do come first.",
  add: "Add a venue",
  showArchived: "Show archived venues",
  hideArchived: "Hide archived venues",
  emptyTitle: "No venues yet",
  emptyText: "Add the first venue to start its album.",
  setup: (v: AdminVenue) =>
    `Setup ${v.setup.done} of ${v.setup.total} in place`,
}

function reviewerLine(v: AdminVenue) {
  const main = v.reviewers.main?.name
  const backup = v.reviewers.backup?.name
  if (!main && !backup) return "No reviewers named"
  return `Reviewers: ${main ?? "no main"} · ${backup ?? "no backup"}`
}

function VenueRow({ venue }: { venue: AdminVenue }) {
  return (
    <li>
      <Link
        href={`/admin/venues/${venue.id}`}
        data-testid="venue-row"
        className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 focus-ring-inset outline-none hover:bg-surface-2"
      >
        <span className="grid min-w-0 gap-1">
          <span className="text-label text-ink">{venue.name}</span>
          <span className="text-meta text-ink-muted">
            {[venue.locality, venue.timezone].filter(Boolean).join(" · ")}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip state={operatingStatusChip(venue.operatingStatus)} />
            {venue.active ? (
              <StatusChip
                state={setupBlocked(venue) ? "needs_setup" : "setup_in_place"}
              >
                {VENUES_COPY.setup(venue)}
              </StatusChip>
            ) : null}
          </span>
          <span className="text-meta text-ink-muted">
            {reviewerLine(venue)}
          </span>
        </span>
        <CaretRightIcon aria-hidden className="size-5 text-ink-muted" />
      </Link>
    </li>
  )
}

/**
 * Venues (spec §8 A2). Venues whose setup is not complete come first
 * (spec §8 A1, blocked setup first), then the rest; each group in name order.
 * Archived venues are listed only on request.
 */
export default async function AdminVenuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const archived = (await searchParams).archived === "1"
  const read = await listAdminVenues(auth.actor, archived)
  if (!read.ok) throw new Error(read.message)
  const blocked = read.venues.filter(setupBlocked)
  const rest = read.venues.filter((v) => !setupBlocked(v))

  return (
    <AppShell variant="admin" active="venues" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <PageHeader
            scope={VENUES_COPY.scope}
            title={VENUES_COPY.title}
            summary={<p>{VENUES_COPY.summary}</p>}
            actions={
              <Link
                href="/admin/venues/new"
                className={buttonVariants({ variant: "primary" })}
                data-testid="venue-add"
              >
                <PlusIcon aria-hidden data-icon="inline-start" />
                {VENUES_COPY.add}
              </Link>
            }
            className="pb-0 md:pb-0"
          />
          <OfflineNotice />
        </div>

        {read.venues.length === 0 ? (
          <EmptyState
            title={VENUES_COPY.emptyTitle}
            description={<p>{VENUES_COPY.emptyText}</p>}
          />
        ) : (
          <>
            {blocked.length ? (
              <section aria-labelledby="venues-blocked" className="grid gap-3">
                <h2
                  id="venues-blocked"
                  className="px-1 type-section-title text-ink"
                >
                  Setup still to do
                </h2>
                <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                  {blocked.map((v) => (
                    <VenueRow key={v.id} venue={v} />
                  ))}
                </ul>
              </section>
            ) : null}
            {rest.length ? (
              <section aria-labelledby="venues-rest" className="grid gap-3">
                <h2
                  id="venues-rest"
                  className="px-1 type-section-title text-ink"
                >
                  {blocked.length ? "Set up" : "All venues"}
                </h2>
                <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                  {rest.map((v) => (
                    <VenueRow key={v.id} venue={v} />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}

        <p className="px-1">
          <Link
            href={archived ? "/admin/venues" : "/admin/venues?archived=1"}
            className="inline-flex min-h-12 items-center text-accent-text underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
          >
            {archived ? VENUES_COPY.hideArchived : VENUES_COPY.showArchived}
          </Link>
        </p>
      </div>
    </AppShell>
  )
}
