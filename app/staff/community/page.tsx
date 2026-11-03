import Link from "next/link"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { EmptyState } from "@/components/nabalens/empty-state"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveStaff } from "@/lib/auth"
import { listCommunityMedia, listCommunityVenues } from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import { canManageVenue } from "../can-manage"
import { CommunityGallery } from "./community-gallery"
import { PhotoFilters } from "./photo-filters"
import {
  activeFilterCount,
  communityFilters,
  communityQuery,
  filterSummary,
  nothingMatches,
  type CommunitySearch,
} from "./search"

export const metadata = { title: "Photos · Naba-Lens" }

const clearFilters = (
  <Link
    href="/staff/community"
    className={buttonVariants({ variant: "secondary", size: "sm" })}
  >
    Clear filters
  </Link>
)

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<CommunitySearch>
}) {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error(auth.message)
  const filters = communityFilters(await searchParams)
  const [media, options, canManage] = await Promise.all([
    listCommunityMedia(auth.actor, filters),
    listCommunityVenues(auth.actor),
    canManageVenue(auth.actor),
  ])
  if (!media.ok) throw new Error(media.message)
  if (!options.ok) throw new Error(options.message)
  const query = communityQuery(filters)
  const search = Object.fromEntries(new URLSearchParams(query))
  const activeCount = activeFilterCount(filters)
  const venueName =
    options.venues.find((venue) => venue.id === filters.venueId)?.name ?? null
  const summary = filterSummary(filters, venueName)

  return (
    <AppShell
      variant="staff"
      active="community"
      canManage={canManage}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="flex flex-col gap-4">
        <OfflineNotice />
        <PageHeader
          scope={venueName ?? "All venues"}
          venueScope={venueName !== null}
          title="Photos"
          summary="newest first"
          actions={
            <PhotoFilters
              key={`filters:${query}`}
              venues={options.venues}
              filters={filters}
              activeCount={activeCount}
            />
          }
          className="pb-0 md:pb-0"
        />
        {summary && media.items.length > 0 ? (
          <Notice role="status" action={clearFilters}>
            {summary}
          </Notice>
        ) : null}
        <CommunityGallery
          key={`gallery:${query}`}
          initialPage={{ items: media.items, nextCursor: media.nextCursor }}
          search={search}
          showCount
          empty={
            activeCount > 0 ? (
              <EmptyState
                variant="filtered"
                title="Nothing matches these filters."
                description={nothingMatches(filters, venueName)}
                action={clearFilters}
              />
            ) : (
              <EmptyState title="No photos yet." />
            )
          }
        />
      </div>
    </AppShell>
  )
}
