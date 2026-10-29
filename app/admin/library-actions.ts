"use server"

import { getMediaActor } from "@/lib/server/media/context"
import { listLibrary, parseLibraryFilters } from "@/lib/server/media/library"
import type { MediaPage } from "@/lib/server/media/types"

export type LibraryPageResult =
  { ok: true; page: MediaPage } | { ok: false; message: string }

/**
 * A page of the admin library with the given filters (`venue`, `staff`, `type`,
 * as in the URL). Without a cursor it returns a fresh first page, used by the
 * 15-second foreground refresh. The accounts track's portfolio view can call it
 * with `{ staff: id }`.
 */
export async function loadLibraryPage(
  filters: {
    venue?: string | null
    staff?: string | null
    type?: string | null
  },
  cursor: string | null
): Promise<LibraryPageResult> {
  const auth = await getMediaActor("admin")
  if (!auth.ok) return { ok: false, message: auth.message }
  const result = await listLibrary(
    auth.actor,
    parseLibraryFilters(filters ?? {}),
    cursor
  )
  if (!result.ok) return { ok: false, message: result.message }
  return {
    ok: true,
    page: { items: result.items, nextCursor: result.nextCursor },
  }
}
