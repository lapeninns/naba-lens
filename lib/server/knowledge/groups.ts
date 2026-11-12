import "server-only"

import {
  GROUP_LIMITS,
  GROUP_SUBJECT_KINDS,
  type ContributionGroupReplaceResult,
  type ContributionGroupView,
  type GroupSubjectKind,
  type KnowledgeResult,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

import {
  knowledgeFailure,
  knowledgeInvalid,
  knowledgeRpcFailure,
} from "./errors"
import { knowledgeRpc } from "./rpc"
import { isObject, isUuid } from "./validate"

// Contribution groups (B02 W1): several of one person's uploads picked
// together for one subject. Each photo keeps its own state; the database
// shows a member only to someone who may already see that photo.

const GROUP_KEY = /^[A-Za-z0-9_-]{8,128}$/

const GROUP_NOT_FOUND = knowledgeFailure(
  "not_found",
  "This group of photos could not be found. Reload the page."
)

function uuidList(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null
  if (!v.every(isUuid)) return null
  return new Set(v).size === v.length ? (v as string[]) : null
}

/**
 * Starts a group for a subject at the caller's upload venue, or returns the
 * one already started with `key` (retry-safe). `subject.id` is the menu item,
 * task or check id; none for kind "none".
 */
export async function startContributionGroup(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ groupId: string }>> {
  if (
    !isObject(input) ||
    typeof input.key !== "string" ||
    !GROUP_KEY.test(input.key)
  )
    return knowledgeInvalid({ key: "Reload the page and try again." })
  const subject = isObject(input.subject) ? input.subject : null
  const kind = subject?.kind
  if (!GROUP_SUBJECT_KINDS.includes(kind as GroupSubjectKind))
    return knowledgeInvalid({ subject: "Choose what these photos show." })
  const id = subject?.id ?? null
  if (kind === "none" ? id !== null : !isUuid(id))
    return knowledgeInvalid({ subject: "Choose what these photos show." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "contribution_group_start",
    {
      p_key: input.key,
      p_subject_kind: kind as GroupSubjectKind,
      p_subject_id: id as string | null,
    }
  )
  if (error) return knowledgeRpcFailure(error, "contribution group start")
  return { ok: true, groupId: data }
}

/** Adds the caller's own photos to their group; safe to repeat. */
export async function addToContributionGroup(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ members: number }>> {
  if (!isObject(input) || !isUuid(input.groupId)) return GROUP_NOT_FOUND
  const assetIds = uuidList(input.assetIds, GROUP_LIMITS.maxMembers)
  if (!assetIds || assetIds.length === 0)
    return knowledgeInvalid({
      assetIds: `Choose up to ${GROUP_LIMITS.maxMembers} photos or videos.`,
    })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "contribution_group_add",
    {
      p_group_id: input.groupId,
      p_asset_ids: assetIds,
    }
  )
  if (error) return knowledgeRpcFailure(error, "contribution group add")
  return { ok: true, members: data }
}

/**
 * Which group each listed photo is in, for photos the caller may already
 * see. For pages that show one card per group.
 */
export async function listGroupsForAssets(
  actor: MediaActor,
  input: unknown
): Promise<
  KnowledgeResult<{ groups: { assetId: string; groupId: string }[] }>
> {
  const assetIds = uuidList(
    isObject(input) ? input.assetIds : null,
    GROUP_LIMITS.maxLookup
  )
  if (!assetIds)
    return knowledgeInvalid({ assetIds: "Reload the page and try again." })
  if (assetIds.length === 0) return { ok: true, groups: [] }
  const { data, error } = await knowledgeRpc(
    actor.db,
    "contribution_groups_for_assets",
    { p_asset_ids: assetIds }
  )
  if (error) return knowledgeRpcFailure(error, "contribution groups")
  return {
    ok: true,
    groups: data.map((r) => ({ assetId: r.asset_id, groupId: r.group_id })),
  }
}

/** One group, with only the members the caller may already see. */
export async function getContributionGroup(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ group: ContributionGroupView }>> {
  if (!isObject(input) || !isUuid(input.groupId)) return GROUP_NOT_FOUND
  const { data, error } = await knowledgeRpc(actor.db, "contribution_group", {
    p_group_id: input.groupId,
  })
  if (error) return knowledgeRpcFailure(error, "contribution group")
  return { ok: true, group: data }
}

/**
 * B05-m5. Replaces a failed, stopped or deleted member of the caller's group
 * with a new upload of their own, one for one; safe to repeat with the same
 * pair. The database checks the group, both assets and the position limit.
 */
export async function replaceInContributionGroup(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ replaced: ContributionGroupReplaceResult }>> {
  if (!isObject(input) || !isUuid(input.groupId)) return GROUP_NOT_FOUND
  const { failedAssetId, newAssetId } = input
  if (!isUuid(failedAssetId) || !isUuid(newAssetId))
    return knowledgeInvalid({ assetIds: "Reload the page and try again." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "contribution_group_replace",
    {
      p_group_id: input.groupId,
      p_failed_asset_id: failedAssetId,
      p_new_asset_id: newAssetId,
    }
  )
  if (error) return knowledgeRpcFailure(error, "contribution group replace")
  return { ok: true, replaced: data }
}
