import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { requireActiveStaff } from "@/lib/auth"
import { listCommunityMedia, listCommunityVenues } from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import { canManageVenue } from "../can-manage"
import { CommunityFilters } from "./community-filters"
import { CommunityGallery } from "./community-gallery"
import {
  communityFilters,
  communityQuery,
  type CommunitySearch,
} from "./search"

export const metadata = { title: "Explore · Naba-Lens" }

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

  return (
    <AppShell
      variant="staff"
      active="community"
      canManage={canManage}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">
            Lapen Inns community
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Explore our work
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Discover photos and videos from colleagues across our venues. Open
            an upload to see who shared it and visit their portfolio.
          </p>
        </div>
        <CommunityFilters
          key={`filters:${query}`}
          action="/staff/community"
          venues={options.venues}
          {...filters}
        />
        <CommunityGallery
          key={`gallery:${query}`}
          initialPage={{ items: media.items, nextCursor: media.nextCursor }}
          search={search}
        />
      </div>
    </AppShell>
  )
}
