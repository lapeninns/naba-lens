import "server-only"

import type { MediaActor } from "@/lib/server/media/types"

import { readAccess } from "./context"
import {
  coverageRpcFailure,
  failure,
  invalid,
  NOT_FOUND,
  NOT_PERMITTED,
  unavailableFailure,
  WRONG_VENUE,
} from "./errors"
import type {
  AssetIneligibleReason,
  CoverageResult,
  ReviewedSubmission,
  SkippedPhoto,
  SubmissionState,
  SubmittedPhoto,
} from "./types"
import {
  intInRange,
  isObject,
  isRequestKey,
  isUuid,
  LIMITS,
  optionalText,
  optionalUuid,
  uuidList,
} from "./validate"
import { readableAssets } from "./views"

const BAD_REQUEST = invalid({}, "This request is invalid. Reload the page.")
const MAX_REVISION = 2 ** 31 - 1

/**
 * Accept a photo, or ask for another one with a reason. Decisions are final
 * and only made on submitted photos; reviewing your own photo is allowed and
 * recorded as self-review. A stale `expectedRevision` is a revision conflict.
 */
export async function reviewSubmission(
  actor: MediaActor,
  input: unknown
): Promise<
  CoverageResult<{ submission: ReviewedSubmission; replayed: boolean }>
> {
  if (!isObject(input)) return BAD_REQUEST
  if (!isRequestKey(input.requestId))
    return invalid({ requestId: "This request is invalid. Reload the page." })
  if (!isUuid(input.submissionId)) return NOT_FOUND
  if (!intInRange(input.expectedRevision, 1, MAX_REVISION)) return BAD_REQUEST
  const decision = input.decision
  if (decision !== "accept" && decision !== "needs_another_photo")
    return invalid({ decision: "Choose accept or needs another photo." })
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined)
    return invalid({ reason: "Use up to 500 characters." })
  if (decision === "needs_another_photo" && !reason)
    return invalid({ reason: "Say what the next photo needs." })

  const { data, error } = await actor.db.rpc("review_coverage_item", {
    p_item_id: input.submissionId,
    p_expected_revision: input.expectedRevision,
    p_decision: decision === "accept" ? "accepted" : "needs_another_photo",
    ...(reason ? { p_reason: reason } : {}),
    p_client_request_key: input.requestId,
  })
  if (error) return coverageRpcFailure(error, "review photo")
  const row = data?.[0]
  if (!row) return unavailableFailure("review photo")
  return {
    ok: true,
    submission: {
      submissionId: row.item_id,
      state: row.state as SubmissionState,
      revision: row.revision,
      selfReview: row.self_review,
    },
    replayed: row.replayed,
  }
}

/**
 * A manager (own venue) or admin attaches existing ready photos taken at the
 * task's venue. Authorship stays with the uploader and attached photos never
 * earn monthly credit. Managers attach active colleagues' photos; admins may
 * also attach retained photos of people who have left.
 */
export async function attachPhotos(
  actor: MediaActor,
  input: unknown
): Promise<
  CoverageResult<{
    submitted: SubmittedPhoto[]
    skipped: SkippedPhoto[]
    replayed: boolean
  }>
> {
  if (!isObject(input)) return BAD_REQUEST
  if (!isRequestKey(input.requestId))
    return invalid({ requestId: "This request is invalid. Reload the page." })
  if (!isUuid(input.requirementId)) return NOT_FOUND
  const requirementId = input.requirementId
  const venueId = optionalUuid(input.venueId)
  if (venueId === undefined) return invalid({ venueId: "Choose a venue." })
  const assetIds = uuidList(input.assetIds, 1, LIMITS.batchMax)
  if (!assetIds)
    return invalid({ assetIds: "Choose between 1 and 10 different photos." })
  const acceptNow = input.acceptNow === true

  const read = await readAccess(actor)
  if (!read.ok) return read
  const { access } = read
  const requirement = await actor.db
    .from("coverage_requirements")
    .select("id, venue_id")
    .eq("id", requirementId)
    .maybeSingle()
  if (requirement.error)
    return unavailableFailure("read requirement", requirement.error)
  if (!requirement.data)
    return failure("not_found", "This task could not be found.")
  const taskVenue = requirement.data.venue_id
  if (venueId && venueId !== taskVenue) return WRONG_VENUE
  if (!access.isAdmin && access.managerVenueId !== taskVenue)
    return NOT_PERMITTED

  const prior = await actor.db
    .from("coverage_submissions")
    .select("kind, asset_ids, requirement_id")
    .eq("submitted_by", actor.profile.id)
    .eq("client_request_key", input.requestId)
    .maybeSingle()
  if (prior.error) return unavailableFailure("read submission", prior.error)

  let send: string[]
  let skipped: SkippedPhoto[] = []
  if (prior.data) {
    if (
      prior.data.kind !== "manager_attach" ||
      prior.data.requirement_id !== requirementId
    )
      return coverageRpcFailure(
        { message: "idempotency_key_reused", code: "22023" },
        "attach photos"
      )
    send = prior.data.asset_ids
    skipped = assetIds
      .filter((id) => !send.includes(id))
      .map((assetId) => ({ assetId, reason: "not_found" as const }))
  } else {
    const [assets, live] = await Promise.all([
      readableAssets(actor, assetIds),
      actor.db
        .from("coverage_submission_items")
        .select("asset_id, requirement_id")
        .in("asset_id", assetIds)
        .in("state", ["submitted", "accepted"])
        .is("archived_at", null),
    ])
    if (!assets.ok) return assets
    if (live.error) return unavailableFailure("read live photos", live.error)
    const liveById = new Map((live.data ?? []).map((l) => [l.asset_id, l]))
    send = []
    for (const id of assetIds) {
      const asset = assets.byId.get(id)
      const l = liveById.get(id)
      let reason: AssetIneligibleReason | null = null
      // Missing covers deleted, still processing and, for a manager, photos of
      // people who have left: the same photos the database refuses.
      if (!asset) reason = "not_found"
      else if (asset.venue_id !== taskVenue) reason = "wrong_venue"
      else if (asset.media_type !== "image") reason = "not_image"
      else if (l?.requirement_id && l.requirement_id !== requirementId)
        reason = "counted_elsewhere"
      if (reason) skipped.push({ assetId: id, reason })
      else send.push(id)
    }
    if (!send.length)
      return failure(
        "asset_ineligible",
        "None of these photos can be added to this task.",
        { assetErrors: skipped }
      )
  }

  const { data, error } = await actor.db.rpc("attach_coverage_evidence", {
    p_requirement_id: requirementId,
    p_asset_ids: send,
    p_client_request_key: input.requestId,
    p_accept: acceptNow,
  })
  if (error) return coverageRpcFailure(error, "attach photos", send)
  return {
    ok: true,
    submitted: (data ?? []).map((r) => ({
      submissionId: r.item_id,
      assetId: r.asset_id,
      state: r.state as SubmissionState,
      revision: r.revision,
      reused: r.reused,
    })),
    skipped,
    replayed: (data ?? []).some((r) => r.replayed),
  }
}
