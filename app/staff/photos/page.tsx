import { loadMyUploadsAction } from "@/app/staff/_me/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { AddVideoButton } from "@/components/nabalens/me/add-video-button"
import { MyPhotos } from "@/components/nabalens/me/my-photos"
import { Notice } from "@/components/nabalens/notice"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { STAFF_ALBUM_POSTS } from "@/lib/config/staff-album-posts"
import { getMediaActor } from "@/lib/server/media/context"
import { getMyUploads } from "@/lib/server/staff"
import { withStaffAlbumStates } from "@/lib/server/staff-album-posts"
import { isPhotoShow } from "@/lib/staff/my-photos"

import { ownMonth, staffShellStatus } from "../_shell/shell-status"
import { ADD_BLOCKED } from "../add-blocked"

export const metadata = { title: "My photos" }

/** Enough of the newest photos for a few days of the grid (§5e step 6). */
const FIRST_PAGE = 60

/**
 * My photos, a tab (DESIGN.md §5e, D19): one Needs you inbox and a grid of
 * the person's photos by day. Each photo opens its own page, where every
 * action is.
 */
export default async function StaffMyPhotosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const actor = auth.actor
  const [params, shell, monthly, uploads] = await Promise.all([
    searchParams,
    staffShellStatus(actor, profile),
    ownMonth(actor),
    getMyUploads(actor, null, FIRST_PAGE).catch(() => null),
  ])
  const blocked = uploadBlockReason(profile)
  const asked = Array.isArray(params.show) ? params.show[0] : params.show
  const page = uploads?.ok ? uploads.page : null
  const initial =
    STAFF_ALBUM_POSTS && page
      ? await withStaffAlbumStates(actor.db, page).catch(() => null)
      : page

  return (
    <AppShell
      variant="staff"
      active="photos"
      {...shell}
      userName={profile.displayName}
      venueName={profile.venue?.name}
      monthly={monthly}
    >
      <div className="mx-auto grid w-full max-w-feed gap-4 pb-4">
        {/* The bar above already says My photos (§15): the title is for
            screen readers, and Add a video sits on the right. */}
        <div className="flex items-center justify-end">
          <h1 className="sr-only">My photos</h1>
          <AddVideoButton blocked={blocked !== null} />
        </div>
        {blocked ? (
          <Notice tone="attention">{ADD_BLOCKED[blocked]}</Notice>
        ) : null}
        <MyPhotos
          initial={initial}
          show={isPhotoShow(asked, STAFF_ALBUM_POSTS) ? asked : "all"}
          posting={STAFF_ALBUM_POSTS}
          currentVenueId={profile.venueId ?? null}
          canAdd={blocked === null}
          loadMore={loadMyUploadsAction}
        />
      </div>
    </AppShell>
  )
}
