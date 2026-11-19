import type * as React from "react"

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
  type AlbumPartKey,
} from "@/lib/album/shelves"
import type { MediaActor } from "@/lib/server/media/types"

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
  const part =
    albumParts(shelves.view).find((p) => p.key === key) ?? emptyPart(key)
  const type = key === "menu" ? partType(part, first(query.kind)) : null
  const asked = first(query.show)
  // A shelf opens on All: its photos and its gaps together (§5d step 5).
  // The folders have no Show of their own.
  const opensOn =
    first(query.shelf) || key === "spaces" ? "all" : defaultShow(type ?? part)
  return (
    <>
      <OfflineNotice className="mb-3" />
      <AlbumPart
        part={part}
        type={type}
        shelfKey={first(query.shelf) ?? null}
        show={isAlbumShow(asked) ? asked : opensOn}
        defaultShow={opensOn}
        lens={shelves.lens}
        places={shelves.places}
        canAdd={blocked === null}
        blocked={blocked ? ADD_BLOCKED[blocked] : null}
      />
    </>
  )
}
