import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AppShell } from "@/components/nabalens/app-shell"
import { AlbumPlaceScreen } from "@/components/nabalens/album/album-place"
import { RememberPlace } from "@/components/nabalens/album/remember-place"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { currentPlace } from "@/lib/album/model"
import { loadAlbum } from "@/lib/server/album"
import { getCoverageActor } from "@/lib/server/coverage"
import { staffShellStatus } from "@/app/staff/_shell/shell-status"

export const metadata: Metadata = { title: "Album" }

/**
 * One place in the album (DESIGN.md §6.2, batch A2): every slot there by
 * section. "unplaced" is the Not placed yet group. An unknown place is 404.
 */
export default async function AlbumPlacePage({
  params,
}: {
  params: Promise<{ placeId: string }>
}) {
  const profile = await requireActiveStaff()
  const auth = await getCoverageActor()
  if (!auth.ok) notFound()
  const { actor } = auth
  const [{ placeId }, shell, album] = await Promise.all([
    params,
    staffShellStatus(actor, profile),
    loadAlbum(actor),
  ])
  const place = album.ok ? currentPlace(album.album, placeId) : null
  if (album.ok && (place?.subjectId ?? "unplaced") !== placeId) notFound()
  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <OfflineNotice className="mb-3" />
      {album.ok && place ? (
        <>
          {/* Album opens on this place next time (DESIGN.md §5a step 3). */}
          <RememberPlace placeId={placeId} />
          <AlbumPlaceScreen
            venueName={profile.venue?.name ?? ""}
            place={place}
            canAdd={uploadBlockReason(profile) === null}
          />
        </>
      ) : (
        <Notice tone="negative" role="alert">
          {album.ok ? "This place has nothing to photograph." : album.message}
        </Notice>
      )}
    </AppShell>
  )
}
