import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AppShell } from "@/components/nabalens/app-shell"
import {
  AlbumPlaceScreen,
  type PlaceFilter,
} from "@/components/nabalens/album/album-place"
import { RememberPlace } from "@/components/nabalens/album/remember-place"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import {
  currentPlace,
  isAlbumShow,
  isCoverageCategory,
} from "@/lib/album/model"
import { loadAlbum } from "@/lib/server/album"
import { rememberedAlbumShow } from "@/lib/server/album-place"
import { getCoverageActor } from "@/lib/server/coverage"
import { staffShellStatus } from "@/app/staff/_shell/shell-status"

export const metadata: Metadata = { title: "Album" }

type SearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/**
 * The filter from the URL, else the state this phone last chose on purpose,
 * else All (spec §6 S3). An unknown value is ignored.
 */
async function placeFilter(params: SearchParams): Promise<PlaceFilter> {
  const asked = first(params.show)
  const show = isAlbumShow(asked)
    ? asked
    : await rememberedAlbumShow().then((v) => (isAlbumShow(v) ? v : "all"))
  const cat = first(params.cat)
  return { show, category: isCoverageCategory(cat) ? cat : null }
}

/**
 * One place in the album (DESIGN.md §6.2, batch A2): every slot there by
 * section. "unplaced" is the Not placed yet group. An unknown place is 404.
 * `?show=` and `?cat=` filter it (spec §6 S3).
 */
export default async function AlbumPlacePage({
  params,
  searchParams,
}: {
  params: Promise<{ placeId: string }>
  searchParams?: Promise<SearchParams>
}) {
  const profile = await requireActiveStaff()
  const auth = await getCoverageActor()
  if (!auth.ok) notFound()
  const { actor } = auth
  const [{ placeId }, shell, album, filter] = await Promise.all([
    params,
    staffShellStatus(actor, profile),
    loadAlbum(actor),
    (searchParams ?? Promise.resolve({} as SearchParams)).then(placeFilter),
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
            filter={filter}
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
