import type * as React from "react"
import { redirect } from "next/navigation"

import { AlbumPart } from "@/components/nabalens/album/album-part"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { uploadBlockReason } from "@/lib/auth"
import { isAlbumShow } from "@/lib/album/model"
import {
  albumParts,
  defaultShow,
  emptyPart,
  partType,
  sectionAnchor,
  sectionShelf,
  type AlbumPartKey,
} from "@/lib/album/shelves"
import type { MediaActor } from "@/lib/server/media/types"
import { STAFF_ALBUM_POSTS } from "@/lib/config/staff-album-posts"

import { ADD_BLOCKED } from "../add-blocked"
import { loadShelves } from "./_shelves"

type SearchParams = Record<string, string | string[] | undefined>
type StaffProfile = Parameters<typeof uploadBlockReason>[0]

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/**
 * The body of one part of the album (DESIGN.md §5d "A part"): Menu,
 * Amenities or Spaces under the place lens (`?place=`), Menu's type
 * (`?kind=`) and the filter (`?show=`). Each part's page draws its own
 * AppShell with the shared staff status around it.
 */
export async function partBody(
  key: AlbumPartKey,
  actor: MediaActor,
  profile: StaffProfile,
  query: SearchParams
): Promise<React.ReactNode> {
  const shelves = await loadShelves(actor, query)
  const blocked = uploadBlockReason(profile)
  if (!shelves.ok)
    return (
      <Notice tone="negative" role="alert">
        {shelves.message}
      </Notice>
    )
  // An old link names a menu section (`?section=`, its id): open its shelf
  // at that section. A section with no slots opens Menu as usual.
  const sectionId = first(query.section)
  if (key === "menu" && sectionId) {
    const slug = shelves.sections.find((s) => s.sectionId === sectionId)?.slug
    const at = slug ? sectionShelf(shelves.view, slug) : null
    const next = new URLSearchParams()
    if (at) next.set("kind", at.category)
    if (at) next.set("shelf", at.shelf)
    const place = first(query.place)
    if (place) next.set("place", place)
    const show = first(query.show)
    if (isAlbumShow(show)) next.set("show", show)
    const rest = next.toString()
    redirect(
      `/staff/album/menu${rest ? `?${rest}` : ""}${at && slug ? `#${sectionAnchor(slug)}` : ""}`
    )
  }
  const part =
    albumParts(shelves.view).find((p) => p.key === key) ?? emptyPart(key)
  const type = key === "menu" ? partType(part, first(query.kind)) : null
  const asked = first(query.show)
  // A shelf opens on All: its photos and its gaps together (§5d step 5).
  // The folders have no Show of their own.
  const opensOn =
    first(query.shelf) || key === "spaces" ? "all" : defaultShow(type ?? part)
  const posting = STAFF_ALBUM_POSTS && key !== "amenities"
  return (
    <>
      <OfflineNotice className="mb-3" />
      <AlbumPart
        part={part}
        type={type}
        shelfKey={first(query.shelf) ?? null}
        show={
          isAlbumShow(asked) && (!posting || asked !== "waiting")
            ? asked
            : opensOn
        }
        defaultShow={opensOn}
        posting={posting}
        lens={shelves.lens}
        places={shelves.places}
        canAdd={blocked === null}
        blocked={blocked ? ADD_BLOCKED[blocked] : null}
      />
    </>
  )
}
