"use server"

import {
  matchBoardOf,
  type MatchBoard,
} from "@/components/nabalens/album/match/model"
import { loadAlbum } from "@/lib/server/album"
import { localDateOf } from "@/lib/server/coverage/time"
import { requestLabelHelp } from "@/lib/server/label-help"
import { getLabellingCatalogue } from "@/lib/server/labels"
import { getMediaActor } from "@/lib/server/media/context"
import { createSpecial } from "@/lib/server/menus/local"

/**
 * Match's board (DESIGN.md §6.1): the caller's empty dish and area slots,
 * read through the album read model with the caller's own session, so the
 * database decides what they may see. Staff only: Match and area labels are
 * staff work. The menu's other names for each dish come with it (spec §5.3,
 * "momos"); without the menu, search still works on the names. The venue is
 * the one these slots belong to, shown while adding (spec §5.1, AC11).
 */
export async function loadMatchBoardAction(): Promise<
  { ok: true; board: MatchBoard } | { ok: false; message: string }
> {
  const auth = await getMediaActor(["staff"])
  if (!auth.ok) return { ok: false, message: auth.message }
  const { profile } = auth.actor
  const [album, menu] = await Promise.all([
    loadAlbum(auth.actor),
    profile.venueId
      ? getLabellingCatalogue(auth.actor, profile.venueId).catch(() => null)
      : null,
  ])
  if (!album.ok) return { ok: false, message: album.message }
  const aliases = new Map<string, readonly string[]>()
  if (menu?.ok && menu.catalogue.status === "active")
    for (const section of menu.catalogue.sections)
      for (const item of section.items)
        if (item.aliases.length > 0) aliases.set(item.itemId, item.aliases)
  const venue =
    profile.venueId && profile.venue
      ? { id: profile.venueId, name: profile.venue.name }
      : null
  return {
    ok: true,
    board: matchBoardOf(album.album, { aliases, venue }),
  }
}

/**
 * "I'm not sure" (FA-4, spec §5.3): sends one of the caller's own photos to
 * the venue's managers as Needs label, as soon as it is reserved. Idempotent;
 * the database checks the uploader and the venue.
 */
export async function requestLabelHelpAction(
  assetId: unknown
): Promise<{ ok: true } | { ok: false; message: string }> {
  const auth = await getMediaActor(["staff"])
  if (!auth.ok) return { ok: false, message: auth.message }
  const result = await requestLabelHelp(auth.actor, assetId)
  return result.ok ? { ok: true } : { ok: false, message: result.message }
}

/** Days a special suggested from Add photos runs, its first day included. */
const SPECIAL_DAYS = 7

/**
 * A dish that is not on the menu (S1-MENUS hand-off): from Add photos, the
 * person suggests it as a local special at their venue, from today for a
 * week. The manager decides (menu_special_create keeps a staff suggestion as
 * "suggested"); nothing is added to the menu until then.
 */
export async function suggestSpecialAction(
  name: unknown,
  kind: unknown
): Promise<{ ok: true } | { ok: false; message: string }> {
  const auth = await getMediaActor(["staff"])
  if (!auth.ok) return { ok: false, message: auth.message }
  const venueId = auth.actor.profile.venueId
  if (!venueId)
    return { ok: false, message: "You are not at a venue right now." }
  const now = new Date()
  const result = await createSpecial(auth.actor, {
    venueId,
    name,
    kind,
    startsOn: localDateOf(now),
    endsOn: localDateOf(
      new Date(now.getTime() + (SPECIAL_DAYS - 1) * 24 * 3600 * 1000)
    ),
  })
  return result.ok ? { ok: true } : { ok: false, message: result.message }
}
