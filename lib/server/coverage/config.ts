import "server-only"

import type { MediaActor } from "@/lib/server/media/types"

import { resolveVenue } from "./context"
import {
  coverageRpcFailure,
  failure,
  invalid,
  NOT_FOUND,
  unavailableFailure,
} from "./errors"
import { isLocalDate, isPeriodKey, periodMonthDate } from "./time"
import type {
  AmenityFactView,
  AmenityPresence,
  CoverageResult,
  CoverageTemplate,
  CoverageTemplateKey,
} from "./types"
import {
  intInRange,
  isObject,
  isRequestKey,
  isUuid,
  LIMITS,
  optionalText,
  uuidList,
} from "./validate"
import {
  evidenceAsset,
  nameMap,
  readableAssets,
  readCompletionTargetPeriods,
  venuePeople,
} from "./views"

const BAD_REQUEST = invalid({}, "This request is invalid. Reload the page.")
const MAX_REVISION = 2 ** 31 - 1
const PRESENCE: AmenityPresence[] = ["present", "absent", "unknown"]

const revisionOrNull = (v: unknown): v is number | null =>
  v === null || intInRange(v, 1, MAX_REVISION)

function optionalDate(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === "") return null
  return isLocalDate(v) ? v : undefined
}

/** The fixed amenity and service checklist templates. */
export async function listCoverageTemplates(
  actor: MediaActor
): Promise<CoverageResult<{ templates: CoverageTemplate[] }>> {
  const { data, error } = await actor.db
    .from("coverage_amenity_templates")
    .select(
      "key, kind, title, default_guidance, suggested_photo_target, needs_fact, position"
    )
    .eq("active", true)
    .order("position")
  if (error) return unavailableFailure("read templates", error)
  return {
    ok: true,
    templates: (data ?? []).map((t) => ({
      key: t.key as CoverageTemplateKey,
      kind: t.kind as CoverageTemplate["kind"],
      title: t.title,
      defaultGuidance: t.default_guidance,
      suggestedPhotoTarget: t.suggested_photo_target,
      needsFact: t.needs_fact,
    })),
  }
}

function requirementFields(input: {
  title: unknown
  guidance: unknown
  photoTarget: unknown
  dueOn: unknown
}):
  | {
      ok: true
      title: string
      guidance: string | null
      photoTarget: number
      dueOn: string | null
    }
  | ReturnType<typeof invalid> {
  const errors: Record<string, string> = {}
  const title = optionalText(input.title, LIMITS.titleMax)
  if (!title) errors.title = "Enter a title of up to 120 characters."
  const guidance = optionalText(input.guidance, LIMITS.guidanceMax)
  if (guidance === undefined) errors.guidance = "Use up to 2000 characters."
  if (!intInRange(input.photoTarget, 1, LIMITS.photoTargetMax))
    errors.photoTarget = "Enter a whole number from 1 to 200."
  const dueOn = optionalDate(input.dueOn)
  if (dueOn === undefined) errors.dueOn = "Choose a valid date."
  if (Object.keys(errors).length) return invalid(errors)
  return {
    ok: true,
    title: title as string,
    guidance: guidance ?? null,
    photoTarget: input.photoTarget as number,
    dueOn: dueOn ?? null,
  }
}

/**
 * A venue-specific or service task; it starts active (creating it confirms
 * it). Retrying with the same `requestId` returns the task already created.
 */
export async function createRequirement(
  actor: MediaActor,
  input: unknown
): Promise<
  CoverageResult<{ requirementId: string; revision: number; replayed: boolean }>
> {
  if (!isObject(input)) return BAD_REQUEST
  if (!isRequestKey(input.requestId))
    return invalid({ requestId: "This request is invalid. Reload the page." })
  if (input.kind !== "service" && input.kind !== "venue_specific")
    return invalid({ kind: "Choose a task type." })
  const fields = requirementFields(
    input as Parameters<typeof requirementFields>[0]
  )
  if (!fields.ok) return fields
  const venue = await resolveVenue(actor, input.venueId)
  if (!venue.ok) return venue
  const { data, error } = await actor.db.rpc("save_coverage_requirement", {
    p_client_request_key: input.requestId,
    p_venue_id: venue.venueId,
    // SQL NULL (create); the generated types mark these arguments non-null.
    p_requirement_id: null as unknown as string,
    p_expected_revision: null as unknown as number,
    p_kind: input.kind,
    p_title: fields.title,
    p_guidance: fields.guidance as string,
    p_photo_target: fields.photoTarget,
    p_due_on: fields.dueOn as string,
  })
  if (error) return coverageRpcFailure(error, "create task")
  const row = data?.[0]
  if (!row) return unavailableFailure("create task")
  return {
    ok: true,
    requirementId: row.requirement_id,
    revision: row.revision,
    replayed: row.replayed,
  }
}

/** Changes a task's title, guidance, photo count or due date (a patch over the current values). */
export async function updateRequirement(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ revision: number }>> {
  if (!isObject(input) || !isUuid(input.requirementId)) return NOT_FOUND
  if (
    !intInRange(input.expectedRevision, 1, MAX_REVISION) ||
    !isObject(input.patch)
  )
    return BAD_REQUEST
  const patch = input.patch
  const current = await actor.db
    .from("coverage_requirements")
    .select("id, title, guidance, photo_target, due_on, revision")
    .eq("id", input.requirementId)
    .maybeSingle()
  if (current.error) return unavailableFailure("read task", current.error)
  if (!current.data)
    return failure("not_found", "This task could not be found.")
  if (current.data.revision !== input.expectedRevision)
    return failure(
      "revision_conflict",
      "This task changed while you were editing it. Reload to see the latest version, then try again.",
      { currentRevision: current.data.revision }
    )
  const fields = requirementFields({
    title: "title" in patch ? patch.title : current.data.title,
    guidance: "guidance" in patch ? patch.guidance : current.data.guidance,
    photoTarget:
      "photoTarget" in patch ? patch.photoTarget : current.data.photo_target,
    dueOn: "dueOn" in patch ? patch.dueOn : current.data.due_on,
  })
  if (!fields.ok) return fields
  const { data, error } = await actor.db.rpc("save_coverage_requirement", {
    p_venue_id: null as unknown as string,
    p_requirement_id: input.requirementId,
    p_expected_revision: input.expectedRevision,
    p_kind: null as unknown as string,
    p_title: fields.title,
    p_guidance: fields.guidance as string,
    p_photo_target: fields.photoTarget,
    p_due_on: fields.dueOn as string,
  })
  if (error) return coverageRpcFailure(error, "update task")
  const row = data?.[0]
  if (!row) return unavailableFailure("update task")
  return { ok: true, revision: row.revision }
}

/**
 * Confirms a task (active), excludes it with a reason (not applicable) or
 * retires it with a reason. Amenity tasks need a confirmed "present" fact
 * before they can be active.
 */
export async function setRequirementStatus(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ revision: number }>> {
  if (!isObject(input) || !isUuid(input.requirementId)) return NOT_FOUND
  if (!intInRange(input.expectedRevision, 1, MAX_REVISION)) return BAD_REQUEST
  const status = input.status
  if (
    status !== "active" &&
    status !== "not_applicable" &&
    status !== "retired"
  )
    return invalid({ status: "Choose a status." })
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined)
    return invalid({ reason: "Use up to 500 characters." })
  if (status !== "active" && !reason)
    return invalid({ reason: "Enter a reason." })
  const { data, error } = await actor.db.rpc(
    "set_coverage_requirement_status",
    {
      p_requirement_id: input.requirementId,
      p_expected_revision: input.expectedRevision,
      p_status: status,
      ...(reason ? { p_reason: reason } : {}),
    }
  )
  if (error) return coverageRpcFailure(error, "set task status")
  return { ok: true, revision: data }
}

/** Replaces the task's assignees with the given set (active staff at the venue, up to 50). */
export async function setRequirementAssignees(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ assigneeIds: string[] }>> {
  if (!isObject(input) || !isUuid(input.requirementId)) return NOT_FOUND
  const ids = uuidList(input.assigneeIds, 0, LIMITS.assigneesMax)
  if (!ids) return invalid({ assigneeIds: "Choose up to 50 different people." })
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined)
    return invalid({ reason: "Use up to 500 characters." })
  const { data, error } = await actor.db.rpc(
    "set_coverage_requirement_assignees",
    {
      p_requirement_id: input.requirementId,
      p_staff_ids: ids,
      ...(reason ? { p_reason: reason } : {}),
    }
  )
  if (error) return coverageRpcFailure(error, "set assignees")
  return { ok: true, assigneeIds: (data ?? []).map((r) => r.staff_id) }
}

/** Amenity facts (present / absent / unknown) for every amenity template at the venue. */
export async function listAmenityFacts(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ facts: AmenityFactView[] }>> {
  const venue = await resolveVenue(
    actor,
    isObject(input) ? input.venueId : null
  )
  if (!venue.ok) return venue
  const venueId = venue.venueId
  const [templates, facts, media, requirements, people] = await Promise.all([
    actor.db
      .from("coverage_amenity_templates")
      .select("key, title, position")
      .eq("active", true)
      .eq("needs_fact", true)
      .order("position"),
    actor.db
      .from("venue_amenity_facts")
      .select(
        "id, amenity_key, presence, facts, policy, confirmed_by, confirmed_at, revision"
      )
      .eq("venue_id", venueId),
    actor.db
      .from("venue_amenity_fact_media")
      .select("fact_id, asset_id")
      .eq("venue_id", venueId),
    actor.db
      .from("coverage_requirements")
      .select("id, amenity_key")
      .eq("venue_id", venueId)
      .not("amenity_key", "is", null)
      .neq("status", "retired"),
    venuePeople(actor, venueId, true),
  ])
  for (const r of [templates, facts, media, requirements])
    if (r.error) return unavailableFailure("read amenity facts", r.error)
  const assets = await readableAssets(actor, [
    ...new Set((media.data ?? []).map((m) => m.asset_id)),
  ])
  if (!assets.ok) return assets
  const factByKey = new Map((facts.data ?? []).map((f) => [f.amenity_key, f]))
  const requirementByKey = new Map(
    (requirements.data ?? []).map((r) => [r.amenity_key, r.id])
  )
  const names = await nameMap(
    actor,
    people,
    (facts.data ?? []).map((f) => f.confirmed_by)
  )
  return {
    ok: true,
    facts: (templates.data ?? []).map((t) => {
      const fact = factByKey.get(t.key)
      return {
        id: fact?.id ?? null,
        templateKey: t.key as CoverageTemplateKey,
        title: t.title,
        presence: (fact?.presence as AmenityPresence | undefined) ?? "unknown",
        facts: fact?.facts ?? null,
        policy: fact?.policy ?? null,
        confirmed: !!fact?.confirmed_at,
        confirmedBy: fact?.confirmed_by
          ? {
              id: fact.confirmed_by,
              displayName: names.get(fact.confirmed_by) ?? null,
            }
          : null,
        confirmedAt: fact?.confirmed_at ?? null,
        supportingAssets: (media.data ?? [])
          .filter((m) => fact && m.fact_id === fact.id)
          .map((m) => {
            const a = assets.byId.get(m.asset_id)
            return evidenceAsset(
              m.asset_id,
              !!a?.has_thumbnail,
              !!a?.has_preview,
              a?.width ?? null,
              a?.height ?? null,
              !!a
            )
          }),
        revision: fact?.revision ?? null,
        requirementId: requirementByKey.get(t.key) ?? null,
      }
    }),
  }
}

/**
 * Records whether an amenity is present, absent or unknown, with optional
 * facts, policy and supporting photos. Photos never set a fact; `confirm`
 * records the caller as confirmer. Unknown cannot be confirmed.
 */
export async function setAmenityFact(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ factId: string; revision: number }>> {
  if (!isObject(input)) return BAD_REQUEST
  if (
    typeof input.templateKey !== "string" ||
    !/^[a-z0-9_]{1,40}$/.test(input.templateKey)
  )
    return failure("not_found", "This amenity could not be found.")
  if (!revisionOrNull(input.expectedRevision)) return BAD_REQUEST
  const errors: Record<string, string> = {}
  if (!PRESENCE.includes(input.presence as AmenityPresence))
    errors.presence = "Choose present, absent or unknown."
  const facts = optionalText(input.facts, LIMITS.factsMax)
  if (facts === undefined) errors.facts = "Use up to 2000 characters."
  const policy = optionalText(input.policy, LIMITS.factsMax)
  if (policy === undefined) errors.policy = "Use up to 2000 characters."
  const confirm = input.confirm === true
  if (confirm && input.presence === "unknown")
    errors.presence = "Unknown needs checking before it can be confirmed."
  const supporting =
    input.supportingAssetIds == null
      ? null
      : uuidList(input.supportingAssetIds, 0, LIMITS.factAssetsMax)
  if (input.supportingAssetIds != null && !supporting)
    errors.supportingAssetIds = "Choose up to 20 different photos."
  if (Object.keys(errors).length) return invalid(errors)
  const venue = await resolveVenue(actor, input.venueId)
  if (!venue.ok) return venue
  const { data, error } = await actor.db.rpc("set_amenity_fact", {
    p_venue_id: venue.venueId,
    p_amenity_key: input.templateKey,
    p_expected_revision: input.expectedRevision as number,
    p_presence: input.presence as string,
    p_facts: facts as string,
    p_policy: policy as string,
    p_confirm: confirm,
    ...(supporting ? { p_asset_ids: supporting } : {}),
  })
  if (error)
    return coverageRpcFailure(error, "save amenity fact", supporting ?? [])
  const row = data?.[0]
  if (!row) return unavailableFailure("save amenity fact")
  return { ok: true, factId: row.fact_id, revision: row.revision }
}

/**
 * Sets one person's monthly photo target at the venue. Current and future
 * months: active staff at the venue now; changing a set current-month target
 * needs a reason. Past months: admins only, with a reason (audited).
 */
export async function setMonthlyTarget(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ targetId: string; revision: number }>> {
  if (!isObject(input) || !isUuid(input.staffId)) return NOT_FOUND
  if (!revisionOrNull(input.expectedRevision)) return BAD_REQUEST
  const errors: Record<string, string> = {}
  const period = input.period
  if (!isPeriodKey(period)) errors.period = "Choose a month."
  if (!intInRange(input.targetCount, 1, LIMITS.targetCountMax))
    errors.targetCount = "Enter a whole number from 1 to 500."
  const dueOn = optionalDate(input.dueOn)
  if (
    dueOn === undefined ||
    (dueOn && isPeriodKey(period) && !dueOn.startsWith(`${period}-`))
  )
    errors.dueOn = "Choose a date within the month."
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined) errors.reason = "Use up to 500 characters."
  if (Object.keys(errors).length) return invalid(errors)
  const venue = await resolveVenue(actor, input.venueId)
  if (!venue.ok) return venue
  const month = periodMonthDate(period as string)
  const completionPeriods = await readCompletionTargetPeriods(
    actor,
    venue.venueId,
    [month]
  )
  if (!completionPeriods.ok) return completionPeriods
  if (completionPeriods.periods.has(month))
    return invalid({}, "This month’s target is set for the whole venue.")
  const { data, error } = await actor.db.rpc("set_monthly_target", {
    p_staff_id: input.staffId,
    p_venue_id: venue.venueId,
    p_period_month: month,
    p_target_count: input.targetCount as number,
    ...(dueOn ? { p_due_on: dueOn } : {}),
    ...(reason ? { p_reason: reason } : {}),
    ...(input.expectedRevision !== null
      ? { p_expected_revision: input.expectedRevision as number }
      : {}),
  })
  if (error) return coverageRpcFailure(error, "set monthly target")
  const row = data?.[0]
  if (!row) return unavailableFailure("set monthly target")
  return { ok: true, targetId: row.target_id, revision: row.revision }
}
