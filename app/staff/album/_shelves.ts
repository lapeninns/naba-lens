import { ALBUM_MOCK_PHOTOS, withMockPhotos } from "@/lib/album/mock-photos"
import { buildShelves, type PlaceLens } from "@/lib/album/shelves"
import { albumShelvesOrNone, loadAlbum } from "@/lib/server/album"
import type { MediaActor } from "@/lib/server/media/types"
import type { LensPlace } from "@/components/nabalens/album/album-lens"

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/**
 * The album as types and shelves under the place lens (DESIGN.md §5d), for
 * Album's landing and a type. A failed album read is returned as is; a
 * failed shelves read leaves every section on its suggested shelf.
 */
export async function loadShelves(
  actor: MediaActor,
  params: Record<string, string | string[] | undefined>
) {
  const [album, chosen] = await Promise.all([
    loadAlbum(actor),
    albumShelvesOrNone(actor),
  ])
  if (!album.ok) return album
  // Dev-only preview of a fuller album (lib/album/mock-photos.ts).
  if (ALBUM_MOCK_PHOTOS) album.album = withMockPhotos(album.album)
  const all = [
    ...album.album.places,
    ...(album.album.unplaced ? [album.album.unplaced] : []),
  ]
  const places: LensPlace[] = all.map((p) => ({
    id: p.subjectId ?? "unplaced",
    label: p.label,
    empty: p.empty,
  }))
  const asked = first(params.place)
  // An unknown place in the URL is ignored: All places.
  const lens: PlaceLens = places.some((p) => p.id === asked)
    ? (asked as string)
    : null
  const view = buildShelves(album.album, {
    chosen,
    lens,
    sectionOrder: album.placements.sections.map((s) => s.slug),
  })
  return {
    ok: true as const,
    view,
    lens,
    places,
    searchPlaces: all,
    sections: album.placements.sections,
  }
}
