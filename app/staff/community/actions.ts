"use server"

import { listCommunityMedia } from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import { communityFilters, type CommunitySearch } from "./search"

export async function loadCommunityPage(
  search: CommunitySearch,
  cursor: string | null,
  uploaderId?: string
) {
  const auth = await getMediaActor("staff")
  if (!auth.ok) return { ok: false as const, message: auth.message }
  const filters = communityFilters(
    search && typeof search === "object" ? search : {}
  )
  const result = await listCommunityMedia(
    auth.actor,
    { ...filters, uploaderId },
    cursor
  )
  if (!result.ok) return { ok: false as const, message: result.message }
  return {
    ok: true as const,
    page: { items: result.items, nextCursor: result.nextCursor },
  }
}
