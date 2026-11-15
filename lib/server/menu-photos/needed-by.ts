import "server-only"

import { failure, invalid } from "@/lib/server/coverage/errors"
import { localDateOf } from "@/lib/server/coverage/time"
import type { NeededBy } from "@/lib/server/coverage/types"
import { isObject, isUuid } from "@/lib/server/coverage/validate"

import type { ManagerPhotoCtx } from "./context"
import { isIsoDate } from "./cursor"
import { BAD_REQUEST, menuPhotoFailure } from "./errors"
import type { MenuPhotoResult } from "./types"

// G-7: "needed by" on one still-needed dish (set_menu_item_needed_by,
// clear_menu_item_needed_by in 20261116150000). The venue's manager acts on
// their own venue; an admin names it. The database re-checks the scope, that
// the dish is on the active menu and still needed, and the date range.
//
// Its refusal messages stay here with the read, as in errors.ts.

type DbError = { message: string; code: string; details?: string } | null

const db = (ctx: ManagerPhotoCtx) => ctx.actor.db

const DATE_RANGE = "Choose a date from today to a year ahead."

function neededByFailure(error: DbError, context: string) {
  const message = error?.message ?? ""
  if (message === "invalid_needed_by") return invalid({ neededBy: DATE_RANGE })
  if (message === "menu_item_has_photo")
    return {
      ...failure(
        "state_conflict",
        "This dish has an accepted photo now, so it is no longer needed. Reload the page."
      ),
      needsRefresh: true,
    }
  if (message === "menu_item_not_found")
    return failure(
      "not_found",
      "This dish could not be found. Reload the page."
    )
  return menuPhotoFailure(error, context)
}

/** Puts a "needed by" date (`{ itemId, neededBy: "YYYY-MM-DD" }`) on a dish. */
export async function setMenuItemNeededBy(
  ctx: ManagerPhotoCtx,
  input: unknown
): Promise<MenuPhotoResult<{ neededBy: NeededBy }>> {
  if (!isObject(input) || !isUuid(input.itemId)) return BAD_REQUEST
  if (!isIsoDate(input.neededBy)) return invalid({ neededBy: DATE_RANGE })
  const { data, error } = await db(ctx).rpc("set_menu_item_needed_by", {
    p_item_id: input.itemId,
    p_needed_by: input.neededBy,
    p_venue_id: ctx.venueId,
  })
  if (error) return neededByFailure(error, "set needed by")
  const row = data?.[0]
  if (!row) return neededByFailure(null, "set needed by")
  // A date is never set in the past, so it has not passed yet.
  return { ok: true, neededBy: { date: row.needed_by, passed: false } }
}

/** Clears a dish's "needed by" date (`{ itemId }`). Clearing twice is fine. */
export async function clearMenuItemNeededBy(
  ctx: ManagerPhotoCtx,
  input: unknown
): Promise<MenuPhotoResult<{ cleared: boolean }>> {
  if (!isObject(input) || !isUuid(input.itemId)) return BAD_REQUEST
  const { data, error } = await db(ctx).rpc("clear_menu_item_needed_by", {
    p_item_id: input.itemId,
    p_venue_id: ctx.venueId,
  })
  if (error) return neededByFailure(error, "clear needed by")
  return { ok: true, cleared: data?.[0]?.cleared === true }
}

/** London "YYYY-MM-DD" bounds the database accepts: today to 366 days ahead. */
export function neededByBounds(now: Date = new Date()): {
  today: string
  maxDate: string
} {
  const today = localDateOf(now)
  const [y, m, d] = today.split("-").map(Number)
  const max = new Date(Date.UTC(y, m - 1, d + 366))
  return { today, maxDate: max.toISOString().slice(0, 10) }
}
