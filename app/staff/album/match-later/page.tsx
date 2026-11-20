import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { AppShell } from "@/components/nabalens/app-shell"
import { MatchLaterScreen } from "@/components/nabalens/album/match/match-later"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { requireActiveStaff } from "@/lib/auth"
import { STAFF_ALBUM_POSTS } from "@/lib/config/staff-album-posts"
import { getMediaActor } from "@/lib/server/media/context"
import type { MediaActor } from "@/lib/server/media/types"
import { getMyUpload } from "@/lib/server/staff"
import { withStaffAlbumStates } from "@/lib/server/staff-album-posts"
import { canLabelUpload, photoHref } from "@/lib/staff/my-uploads"
import { staffShellStatus } from "@/app/staff/_shell/shell-status"
import { listMatchLater } from "@/app/staff/_shell/match-later"

export const metadata: Metadata = { title: "Match later" }

async function loadPhoto(actor: MediaActor, assetId: string) {
  const result = await getMyUpload(actor, assetId)
  if (!result.ok) {
    if (result.code === "not_found") notFound()
    return null
  }
  const upload = STAFF_ALBUM_POSTS
    ? (
        await withStaffAlbumStates(actor.db, {
          items: [result.upload],
          next: null,
        })
      ).items[0]!
    : result.upload
  if (!canLabelUpload(upload, actor.profile.venueId))
    redirect(photoHref(assetId))
  return [
    {
      id: upload.assetId,
      thumbnailUrl: `/api/media/${upload.assetId}/preview`,
      createdAt: upload.uploadedAt,
      revision: upload.labelRevision,
    },
  ]
}

/**
 * Match later (DESIGN.md §2.8, §6.1): the person's own photos added without
 * a slot, matched one at a time. Staff only, like Match.
 */
export default async function MatchLaterPage({
  searchParams,
}: {
  searchParams: Promise<{
    photo?: string | string[]
    select?: string | string[]
  }>
}) {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const { photo, select } = await searchParams
  const assetId = typeof photo === "string" ? photo : null
  const selectPhotos = !assetId && select === "1"
  const [shell, photos] = await Promise.all([
    staffShellStatus(auth.actor, profile),
    assetId ? loadPhoto(auth.actor, assetId) : listMatchLater(auth.actor),
  ])
  return (
    <AppShell
      variant="staff"
      active={assetId || selectPhotos ? "photos" : "tasks"}
      {...shell}
      userName={profile.displayName}
      venueName={profile.venue?.name}
    >
      <OfflineNotice className="mb-3" />
      {photos ? (
        <MatchLaterScreen
          key={assetId ?? (selectPhotos ? "selection" : "queue")}
          photos={photos}
          focused={assetId !== null}
          selectPhotos={selectPhotos}
        />
      ) : (
        <Notice tone="negative" role="alert">
          Your photos could not be loaded. Try again in a moment.
        </Notice>
      )}
    </AppShell>
  )
}
