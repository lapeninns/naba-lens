"use server"

import { revalidatePath } from "next/cache"

import type { AmenityResult } from "@/lib/amenities/contract"
import {
  addChecks,
  archiveCheck,
  assignCheck,
  enableAmenities,
  getAmenityActor,
  getCheck,
  listCatalogue,
  listSubmittableAssets,
  reopenCheck,
  restoreCheck,
  setCheckNotes,
  submitFinding,
} from "@/lib/server/amenities"
import type { MediaActor } from "@/lib/server/media/types"

// Server Functions are reachable by direct POST, so every argument is
// untrusted: each action re-authorises the caller (fresh profile read), the
// service validates the input and derives venue and role itself, and the
// database re-checks scope in the same transaction. Expected failures are
// returned as AmenityResult values, never thrown (Next hides thrown messages
// in production).

type Service<T> = (
  actor: MediaActor,
  input: unknown
) => Promise<AmenityResult<T>>

/** Staff tasks, the legacy and account manager areas, and the admin coverage mirror. */
function refreshAmenities() {
  revalidatePath("/staff", "layout")
  revalidatePath("/manager", "layout")
  revalidatePath("/admin/coverage", "layout")
}

async function read<T>(service: Service<T>, input: unknown) {
  const auth = await getAmenityActor()
  if (!auth.ok) return auth
  return service(auth.actor, input)
}

async function write<T>(service: Service<T>, input: unknown) {
  const auth = await getAmenityActor()
  if (!auth.ok) return auth
  const result = await service(auth.actor, input)
  if (result.ok) refreshAmenities()
  return result
}

// ---- Managers and admins ----------------------------------------------------------

export async function enableAmenitiesAction(input: unknown) {
  return write(enableAmenities, input)
}

export async function addChecksAction(input: unknown) {
  return write(addChecks, input)
}

export async function archiveCheckAction(input: unknown) {
  return write(archiveCheck, input)
}

export async function restoreCheckAction(input: unknown) {
  return write(restoreCheck, input)
}

export async function assignCheckAction(input: unknown) {
  return write(assignCheck, input)
}

export async function setCheckNotesAction(input: unknown) {
  return write(setCheckNotes, input)
}

export async function reopenCheckAction(input: unknown) {
  return write(reopenCheck, input)
}

export async function listCatalogueAction(input: unknown) {
  return read(listCatalogue, input)
}

export async function getCheckAction(input: unknown) {
  return read(getCheck, input)
}

// ---- Capture (assignee, manager or admin) --------------------------------------------

export async function submitFindingAction(input: unknown) {
  return write(submitFinding, input)
}

export async function listSubmittableAssetsAction(input: unknown) {
  return read(listSubmittableAssets, input)
}
