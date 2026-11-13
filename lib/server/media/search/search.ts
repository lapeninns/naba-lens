import "server-only"

import { intInRange } from "@/lib/server/coverage/validate"
import { redactError } from "@/lib/server/log/redact"
import { mediaRoutes } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"

import { decodeSearchCursor, encodeSearchCursor } from "./cursor"
import { searchFailure, searchInvalid, searchRpcFailure } from "./errors"
import { parseSearchFilters } from "./filters"
import { searchRpc } from "./rpc"
import {
  ASSET_SEARCH_PAGE,
  type AssetSearchItem,
  type AssetSearchPage,
  type AssetSearchRow,
  type SearchAnswer,
  type SearchResult,
} from "./types"

export function toSearchItem(
  row: AssetSearchRow,
  answers: SearchAnswer[] = []
): AssetSearchItem {
  const { hasThumbnail, ...rest } = row
  return {
    ...rest,
    thumbnailUrl: hasThumbnail ? mediaRoutes.thumbnail(row.id) : null,
    answers,
  }
}

/**
 * The answers in use each asset supports (B03 K1), by asset id. A failed
 * read leaves every card without answer lines: the other signals still show
 * (§11.2), and the page is not failed for it.
 */
async function answersFor(
  db: Parameters<typeof searchRpc>[0],
  ids: string[]
): Promise<Map<string, SearchAnswer[]>> {
  const out = new Map<string, SearchAnswer[]>()
  if (ids.length === 0) return out
  const { data, error } = await searchRpc(db, "asset_search_answers", {
    p_asset_ids: ids,
  })
  if (error || !data || !Array.isArray(data.items)) {
    console.error("[asset-search] asset_search_answers failed", {
      error: redactError(error ?? { message: "malformed" }),
    })
    return out
  }
  for (const row of data.items)
    if (row && typeof row.assetId === "string" && Array.isArray(row.answers))
      out.set(row.assetId, row.answers)
  return out
}

/**
 * One page of asset search (B05-06a/b) for an admin (every venue) or a
 * venue's effective manager (that venue, through the existing gates only).
 * Staff are refused by the database. Input: `{ filters?, cursor?, limit? }`.
 * Never throws: every expected failure is a value.
 */
export async function searchAssets(
  actor: MediaActor,
  input: unknown
): Promise<SearchResult<AssetSearchPage>> {
  if (!actor.profile.active)
    return searchFailure("not_permitted", "Your account is not active.")
  const body =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  const parsed = parseSearchFilters(body.filters)
  const fieldErrors: Record<string, string> = parsed.ok
    ? {}
    : { ...parsed.fieldErrors }

  let after: { createdAt: string; id: string } | null = null
  if (body.cursor !== undefined && body.cursor !== null && body.cursor !== "") {
    after =
      typeof body.cursor === "string" ? decodeSearchCursor(body.cursor) : null
    if (!after) fieldErrors.cursor = "This page link has expired. Search again."
  }

  let limit: number = ASSET_SEARCH_PAGE.default
  if (body.limit !== undefined && body.limit !== null) {
    if (intInRange(body.limit, 1, ASSET_SEARCH_PAGE.max)) limit = body.limit
    else fieldErrors.limit = `Choose 1 to ${ASSET_SEARCH_PAGE.max} results.`
  }

  if (!parsed.ok || Object.keys(fieldErrors).length > 0)
    return searchInvalid(fieldErrors)

  const { data, error } = await searchRpc(actor.db, "asset_search", {
    p_filters: parsed.db,
    p_after_created_at: after?.createdAt ?? null,
    p_after_id: after?.id ?? null,
    p_limit: limit,
  })
  if (error) return searchRpcFailure(error, "asset_search")
  if (!data || !Array.isArray(data.items))
    return searchRpcFailure({ message: "malformed" }, "asset_search")

  const answers = await answersFor(
    actor.db,
    data.items.map((row) => row.id)
  )
  const items = data.items.map((row) =>
    toSearchItem(row, answers.get(row.id) ?? [])
  )
  // A freshness page that stopped at its 500 candidates resumes after the
  // last row it read, which may be past the last row it returned.
  const resume = data.resumeAfter ?? items[items.length - 1]
  return {
    ok: true,
    items,
    nextCursor:
      data.hasMore && resume
        ? encodeSearchCursor(resume.uploadedAt, resume.id)
        : null,
  }
}
