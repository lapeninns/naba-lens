"use server"

import {
  matchBoardOf,
  type MatchBoard,
} from "@/components/nabalens/album/match/model"
import { loadAlbum } from "@/lib/server/album"
import { getMediaActor } from "@/lib/server/media/context"

/**
 * Match's board (DESIGN.md §6.1): the caller's empty dish and area slots,
 * read through the album read model with the caller's own session, so the
 * database decides what they may see. Staff only: Match and area labels are
 * staff work.
 */
export async function loadMatchBoardAction(): Promise<
  { ok: true; board: MatchBoard } | { ok: false; message: string }
> {
  const auth = await getMediaActor(["staff"])
  if (!auth.ok) return { ok: false, message: auth.message }
  const album = await loadAlbum(auth.actor)
  if (!album.ok) return { ok: false, message: album.message }
  return { ok: true, board: matchBoardOf(album.album) }
}
