import "server-only"

import {
  listReviewQueue,
  type ManagerPhotoCtx,
  type MenuPhotoResult,
  type QueueCard,
} from "@/lib/server/menu-photos"

/** Most queue pages the Needs label list reads (24 photos each). */
export const NEEDS_LABEL_PAGES = 20

/**
 * Every photo that still needs a label (FA-4, the one unlabelled rule), read
 * page by page (S3-R13 X2): the list and its heading count all of them, not
 * the first queue page only. `more` is true when photos remain past
 * NEEDS_LABEL_PAGES pages.
 */
export async function listAllNeedsLabel(
  ctx: ManagerPhotoCtx,
  filters: Record<string, unknown>
): Promise<MenuPhotoResult<{ items: QueueCard[]; more: boolean }>> {
  const items: QueueCard[] = []
  let cursor: string | null = null
  for (let page = 0; page < NEEDS_LABEL_PAGES; page++) {
    const read = await listReviewQueue(ctx, {
      ...filters,
      status: "unlabelled",
      ...(cursor ? { cursor } : {}),
    })
    if (!read.ok) return read
    items.push(...read.items.filter((c) => c.kind === "unlabelled"))
    cursor = read.nextCursor
    if (!cursor) return { ok: true, items, more: false }
  }
  return { ok: true, items, more: true }
}
