import "server-only"

import { listOwnMediaByIds } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"

import {
  failure,
  invalid,
  NOT_FOUND,
  NOT_PERMITTED,
  unavailableFailure,
  type DbError,
} from "./errors"
import type { CoverageResult, RetakeNote, RetakeNoteRef } from "./types"
import { isObject, isUuid } from "./validate"

// Retake notes (G-3, docs/plans/goals-not-tasks.md, decisions 4 and 14). The
// database decides each note's status; Home and Me share this one read.

// my_retake_notes and set_retake_note_aside are not in lib/db/types.ts yet
// (regenerated once by the coordinator), so they are called through this
// narrow view of the client.
type NoteRow = {
  kind: "menu" | "coverage"
  note_id: string
  note_revision: number
  asset_id: string
  item_id: string | null
  variant_id: string | null
  item_name: string | null
  variant_name: string | null
  requirement_id: string | null
  requirement_title: string | null
  requirement_kind: string | null
  reason: string | null
  asked_by_name: string | null
  asked_at: string
  status: RetakeNote["status"]
  can_retake: boolean
  set_aside_at: string | null
}
type RpcClient = {
  rpc: (
    fn: string,
    args?: object
  ) => PromiseLike<{ data: unknown; error: DbError }>
}
const rpc = (actor: MediaActor, fn: string, args: object = {}) =>
  (actor.db as unknown as RpcClient).rpc(fn, args)

function noteView(row: NoteRow, thumbnailUrl: string | null): RetakeNote {
  return {
    kind: row.kind,
    noteId: row.note_id,
    revision: row.note_revision,
    assetId: row.asset_id,
    thumbnailUrl,
    status: row.status,
    canRetake: row.can_retake,
    reason: row.reason,
    askedBy: row.asked_by_name,
    askedAt: row.asked_at,
    setAsideAt: row.set_aside_at,
    dish:
      row.kind === "menu" && row.item_id && row.item_name
        ? {
            itemId: row.item_id,
            variantId: row.variant_id,
            itemName: row.item_name,
            variantName: row.variant_name,
          }
        : null,
    requirement:
      row.requirement_id && row.requirement_title
        ? {
            id: row.requirement_id,
            title: row.requirement_title,
            kind: row.requirement_kind ?? "",
          }
        : null,
  }
}

/**
 * The caller's own retake notes, newest first, with every status (Home shows
 * the open ones; Me shows all but cleared). Thumbnails come from the caller's
 * own photos, so a failed signing read only drops the pictures.
 */
export async function listMyRetakeNotes(
  actor: MediaActor
): Promise<CoverageResult<{ notes: RetakeNote[] }>> {
  if (!actor.profile.active)
    return failure("account_inactive", "Your account is not active.")
  if (actor.profile.role !== "staff") return NOT_PERMITTED
  const { data, error } = await rpc(actor, "my_retake_notes")
  if (error) return unavailableFailure("retake notes", error)
  const rows = (data ?? []) as NoteRow[]
  const shown = rows.filter((row) => row.status !== "cleared")
  const media = shown.length
    ? await listOwnMediaByIds(actor, [
        ...new Set(shown.map((row) => row.asset_id)),
      ]).catch(() => null)
    : null
  const thumbs = new Map(
    (media?.ok ? media.items : []).map((item) => [item.id, item.thumbnailUrl])
  )
  return {
    ok: true,
    notes: rows.map((row) => noteView(row, thumbs.get(row.asset_id) ?? null)),
  }
}

function retakeRef(input: unknown): RetakeNoteRef | null {
  if (!isObject(input)) return null
  const { kind, noteId } = input
  if (kind !== "menu" && kind !== "coverage") return null
  if (!isUuid(noteId)) return null
  return { kind, noteId }
}

/** Later: hide one of my own notes from Home. Repeating it changes nothing. */
export async function setRetakeNoteAside(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ setAsideAt: string; replayed: boolean }>> {
  const ref = retakeRef(input)
  if (!ref) return invalid({}, "This request is invalid. Reload the page.")
  if (!actor.profile.active)
    return failure("account_inactive", "Your account is not active.")
  const { data, error } = await rpc(actor, "set_retake_note_aside", {
    [ref.kind === "menu" ? "p_photo_id" : "p_submission_item_id"]: ref.noteId,
  })
  if (error) {
    switch (error.message) {
      case "retake_note_not_found":
        return NOT_FOUND
      case "retake_note_not_open":
        return failure(
          "state_conflict",
          "This note has already been answered. Reload the page."
        )
      case "work_profile_forbidden":
        return NOT_PERMITTED
      case "invalid_retake_note":
        return invalid({}, "This request is invalid. Reload the page.")
      default:
        return unavailableFailure("set retake note aside", error)
    }
  }
  const row = (
    data as { set_aside_at: string; replayed: boolean }[] | null
  )?.[0]
  if (!row) return unavailableFailure("set retake note aside")
  return { ok: true, setAsideAt: row.set_aside_at, replayed: row.replayed }
}
