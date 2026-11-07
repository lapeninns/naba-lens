"use server"

import { revalidatePath } from "next/cache"

import {
  attachPhotos,
  confirmMenuCoverage,
  createRequirement,
  discardMenuCoverage,
  getCoverageActor,
  getMyMenuPhotoStates,
  getMyMonth,
  getOurMenu,
  grantVenueManager,
  listItemPhotoCandidates,
  listItemPhotoSelfReviews,
  listMySubmittablePhotos,
  listOurMenuItems,
  listPreparationRuns,
  listReviewQueue,
  listSelfReviews,
  listVenuePhotos,
  prepareMonth,
  reconcileMenuRequirement,
  reviewItemPhoto,
  reviewSubmission,
  revokeVenueManager,
  setAmenityFact,
  setMonthlyTarget,
  setPrimaryItemPhoto,
  setRequirementAssignees,
  setRequirementStatus,
  startMenuCoverage,
  submitPhotos,
  updateRequirement,
  withdrawItemPhoto,
} from "@/lib/server/coverage"
import type { CoverageResult } from "@/lib/server/coverage/types"
import type { MediaActor } from "@/lib/server/media/types"

// Server Functions are reachable by direct POST, so every argument is
// untrusted: each action re-authorises the caller (fresh profile read), the
// service validates the input and derives venue and role itself, and the
// database re-checks scope in the same transaction. Expected failures are
// returned as CoverageResult values, never thrown (Next hides thrown
// messages in production).

type Service<T> = (
  actor: MediaActor,
  input: unknown
) => Promise<CoverageResult<T>>

/** Pages that show coverage state: staff tasks and the manager area, and admin coverage. */
function refreshCoverage(...extra: string[]) {
  revalidatePath("/staff", "layout")
  revalidatePath("/admin/coverage", "layout")
  for (const path of extra) revalidatePath(path, "layout")
}

async function read<T>(service: Service<T>, input: unknown) {
  const auth = await getCoverageActor()
  if (!auth.ok) return auth
  return service(auth.actor, input)
}

async function write<T>(
  service: Service<T>,
  input: unknown,
  ...extra: string[]
) {
  const auth = await getCoverageActor()
  if (!auth.ok) return auth
  const result = await service(auth.actor, input)
  if (result.ok) refreshCoverage(...extra)
  return result
}

// ---- Staff ---------------------------------------------------------------------

export async function submitPhotosAction(input: unknown) {
  return write(submitPhotos, input)
}

export async function loadSubmittablePhotosAction(input: unknown) {
  return read(listMySubmittablePhotos, input)
}

export async function loadMyMonthAction(input: unknown) {
  return read(getMyMonth, input)
}

// ---- Managers and admins ----------------------------------------------------------

export async function reviewSubmissionAction(input: unknown) {
  return write(reviewSubmission, input)
}

export async function attachPhotosAction(input: unknown) {
  return write(attachPhotos, input)
}

export async function loadReviewQueueAction(input: unknown) {
  return read(listReviewQueue, input)
}

export async function loadVenuePhotosAction(input: unknown) {
  return read(listVenuePhotos, input)
}

export async function createRequirementAction(input: unknown) {
  return write(createRequirement, input)
}

export async function updateRequirementAction(input: unknown) {
  return write(updateRequirement, input)
}

export async function setRequirementStatusAction(input: unknown) {
  return write(setRequirementStatus, input)
}

export async function setRequirementAssigneesAction(input: unknown) {
  return write(setRequirementAssignees, input)
}

export async function setAmenityFactAction(input: unknown) {
  return write(setAmenityFact, input)
}

export async function setMonthlyTargetAction(input: unknown) {
  return write(setMonthlyTarget, input)
}

export async function startMenuCoverageAction(input: unknown) {
  return write(startMenuCoverage, input)
}

export async function confirmMenuCoverageAction(input: unknown) {
  return write(confirmMenuCoverage, input)
}

export async function discardMenuCoverageAction(input: unknown) {
  return write(discardMenuCoverage, input)
}

export async function reconcileMenuRequirementAction(input: unknown) {
  return write(reconcileMenuRequirement, input)
}

export async function prepareMonthAction(input: unknown) {
  return write(prepareMonth, input)
}

// ---- Admins ---------------------------------------------------------------------------

export async function grantVenueManagerAction(input: unknown) {
  return write(grantVenueManager, input, "/admin/staff")
}

export async function revokeVenueManagerAction(input: unknown) {
  return write(revokeVenueManager, input, "/admin/staff")
}

export async function loadSelfReviewsAction(input: unknown) {
  return read(listSelfReviews, input)
}

export async function loadPreparationRunsAction(input: unknown) {
  return read(listPreparationRuns, input)
}

// ---- Our menu: menu items with an accepted photo ------------------------------------
// Staff read their own venue; the venue's manager and admins review. Writes
// refresh the staff and admin coverage layouts, which include Our menu.

export async function loadOurMenuAction(input: unknown) {
  return read(getOurMenu, input)
}

export async function loadOurMenuItemsAction(input: unknown) {
  return read(listOurMenuItems, input)
}

export async function loadMyMenuPhotoStatesAction(input: unknown) {
  return read(getMyMenuPhotoStates, input)
}

export async function loadItemPhotoCandidatesAction(input: unknown) {
  return read(listItemPhotoCandidates, input)
}

export async function reviewItemPhotoAction(input: unknown) {
  return write(reviewItemPhoto, input)
}

export async function withdrawItemPhotoAction(input: unknown) {
  return write(withdrawItemPhoto, input)
}

export async function setPrimaryItemPhotoAction(input: unknown) {
  return write(setPrimaryItemPhoto, input)
}

export async function loadItemPhotoSelfReviewsAction(input: unknown) {
  return read(listItemPhotoSelfReviews, input)
}
