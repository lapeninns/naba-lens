"use server"

import { getMediaActor } from "@/lib/server/media/context"
import { listLibrary, parseLibraryFilters } from "@/lib/server/media/library"
import type { MediaPage } from "@/lib/server/media/types"

import type { LibrarySearchParams } from "./library-search"

export type LibraryPageResult =
  { ok: true; page: MediaPage } | { ok: false; message: string }

/**
 * A page of the admin library with the given filters (the URL params of
 * /admin: `venue`, `staff`, `type`, `item`, `variant`, `category`, `content`,
 * `labels`, `q`, `from`, `to`). Without a cursor it returns a fresh first
 * page. The admin portfolio (/admin/staff/[id]) calls it with `{ staff: id }`.
 * Untrusted input: invalid values are ignored by parseLibraryFilters.
 */
export async function loadLibraryPage(
  filters: LibrarySearchParams,
  cursor: string | null
): Promise<LibraryPageResult> {
  const auth = await getMediaActor("admin")
  if (!auth.ok) return { ok: false, message: auth.message }
  const result = await listLibrary(
    auth.actor,
    parseLibraryFilters(
      typeof filters === "object" && filters !== null ? filters : {}
    ),
    cursor
  )
  if (!result.ok) return { ok: false, message: result.message }
  return {
    ok: true,
    page: { items: result.items, nextCursor: result.nextCursor },
  }
}
