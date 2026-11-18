import "server-only"

import {
  isShotTemplateText,
  parseExampleChoices,
  parseShotTemplates,
  parseSlotBriefs,
  SHOT_TEMPLATE_MAX,
  type ExampleChoice,
  type ShotTemplate,
  type SlotBriefs,
} from "@/lib/album/brief"
import type { CoverageCategory } from "@/lib/album/model"
import {
  failure,
  invalid,
  NOT_PERMITTED,
  unavailableFailure,
  type DbError,
} from "@/lib/server/coverage/errors"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import { isUuid } from "@/lib/server/coverage/validate"
import type { MediaActor } from "@/lib/server/media/types"

// FA-52 shot templates and the one slot brief resolver
// (20261118134000_shot_templates.sql). The database checks every rule again:
// admins on an aal2 session write, everyone active reads, and a slot's brief
// is resolved by public.slot_briefs only.

type Result<T> = ({ ok: true } & T) | CoverageFailure

const MESSAGES: Record<string, CoverageFailure> = {
  not_admin: NOT_PERMITTED,
  not_active_user: NOT_PERMITTED,
  not_venue_manager: NOT_PERMITTED,
  wrong_venue: NOT_PERMITTED,
  venue_required: failure("invalid_input", "Choose a venue first."),
  invalid_category: failure("invalid_input", "Reload the page."),
  invalid_cursor: failure("invalid_input", "Reload the page."),
  instruction_required: invalid({
    instruction: "Write one line on what the photo must show.",
  }),
  invalid_instruction: invalid({
    instruction: `Write the instruction as one line of ${SHOT_TEMPLATE_MAX} characters or fewer.`,
  }),
  invalid_reason: invalid({
    reason: "Keep the reason to 500 characters or fewer.",
  }),
  invalid_example: failure(
    "asset_ineligible",
    "That photo is no longer accepted for public use. Choose another."
  ),
  stale_revision: failure(
    "revision_conflict",
    "Someone else changed this template since you opened it. Reload to see their change, then make yours again."
  ),
}

function templateFailure(error: DbError, context: string): CoverageFailure {
  const known = error?.message ? MESSAGES[error.message] : undefined
  return known ?? unavailableFailure(context, error)
}

/**
 * Every slot's brief at the caller's venue (an admin or a manager names
 * one), resolved by public.slot_briefs. `includeRequests: false` leaves out
 * open requests' briefs: a manager starting a new request sees the slot's
 * standing brief.
 */
export async function loadSlotBriefs(
  actor: MediaActor,
  opts: { venueId?: string; includeRequests?: boolean } = {}
): Promise<Result<{ briefs: SlotBriefs }>> {
  const { data, error } = await actor.db.rpc("slot_briefs", {
    ...(opts.venueId ? { p_venue_id: opts.venueId } : {}),
    p_include_requests: opts.includeRequests ?? true,
  })
  if (error) return templateFailure(error, "slot briefs")
  const briefs = parseSlotBriefs(data)
  return briefs
    ? { ok: true, briefs }
    : unavailableFailure("slot briefs payload", null)
}

/** The five templates, in category order. */
export async function loadShotTemplates(
  actor: MediaActor
): Promise<Result<{ templates: ShotTemplate[] }>> {
  const { data, error } = await actor.db.rpc("shot_templates")
  if (error) return templateFailure(error, "shot templates")
  const templates = parseShotTemplates(data)
  return templates
    ? { ok: true, templates }
    : unavailableFailure("shot templates payload", null)
}

/** Public-level Library photos an admin may choose as an example. */
export async function listExampleChoices(
  actor: MediaActor,
  opts: { venueId?: string | null; before?: { at: string; id: string } | null }
): Promise<
  Result<{
    items: ExampleChoice[]
    nextCursor: { at: string; id: string } | null
  }>
> {
  const { data, error } = await actor.db.rpc("shot_template_example_choices", {
    ...(opts.venueId && isUuid(opts.venueId)
      ? { p_venue_id: opts.venueId }
      : {}),
    ...(opts.before ? { p_before: opts.before } : {}),
  })
  if (error) return templateFailure(error, "shot template examples")
  const page = parseExampleChoices(data)
  return page
    ? { ok: true, ...page }
    : unavailableFailure("shot template examples payload", null)
}

export type SaveShotTemplateInput = {
  category: CoverageCategory
  instruction: unknown
  exampleAssetId: unknown
  revision: unknown
  reason: unknown
}

/** Saves one template; a repeat with the same values changes nothing. */
export async function saveShotTemplate(
  actor: MediaActor,
  input: SaveShotTemplateInput
): Promise<Result<{ changed: boolean; revision: number }>> {
  if (typeof input.instruction !== "string")
    return MESSAGES.instruction_required
  const instruction = input.instruction.trim()
  if (!instruction) return MESSAGES.instruction_required
  if (!isShotTemplateText(instruction)) return MESSAGES.invalid_instruction
  const example =
    typeof input.exampleAssetId === "string" && input.exampleAssetId
      ? input.exampleAssetId
      : null
  if (example && !isUuid(example)) return MESSAGES.invalid_example
  const revision = Number(input.revision)
  if (!Number.isInteger(revision) || revision < 1)
    return MESSAGES.stale_revision
  const reason =
    typeof input.reason === "string" ? input.reason.trim() || null : null
  if (reason && reason.length > 500) return MESSAGES.invalid_reason

  const { data, error } = await actor.db.rpc("shot_template_set", {
    p_category: input.category,
    p_instruction: instruction,
    p_example_asset_id: example as string,
    p_expected_revision: revision,
    p_reason: reason as string,
  })
  if (error) return templateFailure(error, "shot template set")
  const result = data as { changed?: unknown; revision?: unknown } | null
  return {
    ok: true,
    changed: result?.changed === true,
    revision: Number(result?.revision) || revision,
  }
}
