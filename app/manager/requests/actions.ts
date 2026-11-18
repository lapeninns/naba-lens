"use server"

import { revalidatePath } from "next/cache"

import {
  INTENDED_USES,
  ORIENTATIONS,
  PRIORITIES,
  REQUEST_TYPES,
  SHOT_LIST_PURPOSES,
  TEAMS,
  type RequestSlotKind,
} from "@/lib/requests/model"
import { getAmenityActor } from "@/lib/server/amenities"
import type { ApiError } from "@/lib/server/http/errors"
import { actorFailureMessage } from "@/lib/server/media/context"
import {
  cancelShotList,
  closeRequest,
  createManagerRequest,
  createShotList,
  editRequest,
  setRequestBlocked,
  type RequestPatch,
} from "@/lib/server/requests"

// Requests and shot lists (spec §7 M4; S2-REQ). Reachable by direct POST, so
// every input is untrusted: shapes are checked here, and the database checks
// the venue, the manager's role and every value again. Failures come back as
// values with the field they are about, never thrown.

export type RequestActionResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; error: string; field?: string }

/** A failed account check, in its own words (review V6). */
const signedOut = (auth: { status: number; message: string }) => ({
  ok: false as const,
  error: actorFailureMessage(auth),
})

function failed(error: ApiError): { ok: false; error: string; field?: string } {
  return {
    ok: false,
    error:
      error.code === "invalid_input" || error.code === "conflict"
        ? error.message
        : `${error.message} ${error.nextAction}`,
    ...(error.field ? { field: error.field } : {}),
  }
}

function refresh(requestId?: string) {
  revalidatePath("/manager/requests")
  if (requestId) revalidatePath(`/manager/requests/${requestId}`)
  // Staff Album shows open requests as slots with their brief.
  revalidatePath("/staff", "layout")
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
const text = (v: unknown) => (typeof v === "string" ? v : null)
const optText = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v)
    ? (v as T)
    : null
const int = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) ? v : null
const SLOT_KINDS: readonly RequestSlotKind[] = ["dish", "area", "amenity"]

export async function createRequestAction(
  input: unknown
): Promise<RequestActionResult<{ id: string }>> {
  const auth = await getAmenityActor()
  if (!auth.ok) return signedOut(auth)
  const i = obj(input)
  const type = oneOf(REQUEST_TYPES, i.type)
  if (!type)
    return { ok: false, error: "Choose the kind of request.", field: "type" }
  const result = await createManagerRequest(auth.actor, {
    type,
    slotKind: oneOf(SLOT_KINDS, i.slotKind),
    slotId: optText(i.slotId),
    factCheckId: optText(i.factCheckId),
    subject: optText(i.subject),
    brief: optText(i.brief),
    intendedUse: oneOf(INTENDED_USES, i.intendedUse),
    team: oneOf(TEAMS, i.team),
    photoCount: int(i.photoCount) ?? 1,
    priority: oneOf(PRIORITIES, i.priority) ?? "normal",
    assigneeId: optText(i.assigneeId),
    date: optText(i.date),
    orientation: oneOf(ORIENTATIONS, i.orientation),
    wantsVideo: i.wantsVideo === true,
    captureWindow: optText(i.captureWindow),
    shotListId: optText(i.shotListId),
  })
  if (!result.ok) return failed(result)
  refresh(result.id)
  return { ok: true, id: result.id }
}

/** Keys a manager may change; a null clears an optional field. */
function patchFrom(raw: unknown): RequestPatch | null {
  const p = obj(raw)
  const out: RequestPatch = {}
  for (const key of Object.keys(p)) {
    const v = p[key]
    switch (key) {
      case "brief": {
        const brief = text(v)
        if (brief === null) return null
        out.brief = brief
        break
      }
      case "intendedUse": {
        const use = oneOf(INTENDED_USES, v)
        if (!use) return null
        out.intendedUse = use
        break
      }
      case "team": {
        const team = oneOf(TEAMS, v)
        if (!team) return null
        out.team = team
        break
      }
      case "priority": {
        const priority = oneOf(PRIORITIES, v)
        if (!priority) return null
        out.priority = priority
        break
      }
      case "photoCount": {
        const n = int(v)
        if (n === null) return null
        out.photoCount = n
        break
      }
      case "wantsVideo":
        if (typeof v !== "boolean") return null
        out.wantsVideo = v
        break
      case "orientation":
        if (v !== null && !oneOf(ORIENTATIONS, v)) return null
        out.orientation = v as RequestPatch["orientation"]
        break
      case "assigneeId":
      case "date":
      case "referenceAssetId":
      case "captureWindow":
      case "shotListId":
        if (v !== null && typeof v !== "string") return null
        out[key] = optText(v)
        break
      default:
        return null
    }
  }
  return out
}

export async function editRequestAction(input: {
  requestId: unknown
  revision: unknown
  patch: unknown
}): Promise<RequestActionResult> {
  const auth = await getAmenityActor()
  if (!auth.ok) return signedOut(auth)
  const requestId = text(input.requestId)
  const revision = int(input.revision)
  const patch = patchFrom(input.patch)
  if (!requestId || revision === null || !patch)
    return { ok: false, error: "Reload the page and try again." }
  const result = await editRequest(auth.actor, { requestId, revision, patch })
  if (!result.ok) return failed(result)
  if (result.changed) refresh(requestId)
  return { ok: true }
}

export async function setRequestBlockedAction(input: {
  requestId: unknown
  revision: unknown
  reason: unknown
}): Promise<RequestActionResult> {
  const auth = await getAmenityActor()
  if (!auth.ok) return signedOut(auth)
  const requestId = text(input.requestId)
  const revision = int(input.revision)
  if (!requestId || revision === null)
    return { ok: false, error: "Reload the page and try again." }
  const result = await setRequestBlocked(auth.actor, {
    requestId,
    revision,
    reason: optText(input.reason),
  })
  if (!result.ok) return failed(result)
  refresh(requestId)
  return { ok: true }
}

export async function closeRequestAction(input: {
  requestId: unknown
  revision: unknown
  state: unknown
  reason: unknown
}): Promise<RequestActionResult> {
  const auth = await getAmenityActor()
  if (!auth.ok) return signedOut(auth)
  const requestId = text(input.requestId)
  const revision = int(input.revision)
  const state = oneOf(["completed", "cancelled"] as const, input.state)
  if (!requestId || revision === null || !state)
    return { ok: false, error: "Reload the page and try again." }
  const result = await closeRequest(auth.actor, {
    requestId,
    revision,
    state,
    reason: optText(input.reason),
  })
  if (!result.ok) return failed(result)
  refresh(requestId)
  return { ok: true }
}

export async function createShotListAction(
  input: unknown
): Promise<RequestActionResult<{ id: string }>> {
  const auth = await getAmenityActor()
  if (!auth.ok) return signedOut(auth)
  const i = obj(input)
  const purpose = oneOf(SHOT_LIST_PURPOSES, i.purpose)
  if (!purpose)
    return { ok: false, error: "Choose what it is for.", field: "purpose" }
  const result = await createShotList(auth.actor, {
    name: text(i.name) ?? "",
    purpose,
    date: optText(i.date),
    note: optText(i.note),
  })
  if (!result.ok) return failed(result)
  refresh()
  return { ok: true, id: result.id }
}

export async function cancelShotListAction(input: {
  shotListId: unknown
  revision: unknown
  reason: unknown
}): Promise<RequestActionResult<{ requestsCancelled: number }>> {
  const auth = await getAmenityActor()
  if (!auth.ok) return signedOut(auth)
  const shotListId = text(input.shotListId)
  const revision = int(input.revision)
  if (!shotListId || revision === null)
    return { ok: false, error: "Reload the page and try again." }
  const result = await cancelShotList(auth.actor, {
    shotListId,
    revision,
    reason: text(input.reason) ?? "",
  })
  if (!result.ok) return failed(result)
  refresh()
  return { ok: true, requestsCancelled: result.requestsCancelled }
}
