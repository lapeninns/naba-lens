import "server-only"

import {
  GROUP_LIMITS,
  GROUP_SUBJECT_KINDS,
  type ContributionGroupReplaceResult,
  type ContributionGroupView,
  type ContributionsFeedPage,
  type GroupSubjectKind,
  type KnowledgeFailure,
  type KnowledgeRpcName,
  type KnowledgeRpcs,
} from "@/lib/knowledge/contract"
import { knowledgeRpcFailure } from "@/lib/server/knowledge"
import { knowledgeRpc } from "@/lib/server/knowledge/rpc"
import type { MediaActor } from "@/lib/server/media/types"

import type {
  AssetGroup,
  DeleteImpact,
  GroupSubjectRef,
  LabelWork,
  TriageRow,
  VenueCapabilities,
} from "./contract"
import {
  parseAssetGroups,
  parseCapabilities,
  parseContributionsPage,
  parseDeleteImpact,
  parseGroupId,
  parseGroupMembers,
  parseGroupReplace,
  parseGroupView,
  parseLabelWork,
  parseTriage,
} from "./parse"

/**
 * A B02 read as a screen needs it. `missing`: the database predates B02, so
 * the screen keeps its B01 surface (as B01's working list does before its
 * migrations); `failed`: the read itself failed, so the screen says so.
 */
export type WorkRead<T> =
  | { status: "ok"; value: T }
  | { status: "missing" }
  | { status: "failed"; failure: KnowledgeFailure }

/** PostgREST and Postgres "no such function". */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"])

const UNREADABLE: KnowledgeFailure = {
  ok: false,
  code: "unavailable",
  status: 503,
  message: "This couldn't be loaded. Try again.",
}

/** R5's page size; the server's cursor is passed back untouched. */
export const CONTRIBUTIONS_PAGE = 20

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const GROUP_KEY = /^[A-Za-z0-9_-]{8,128}$/

const INVALID_GROUP: WorkRead<never> = {
  status: "failed",
  failure: {
    ok: false,
    code: "invalid_input",
    status: 400,
    message: "Reload the page and try again.",
  },
}

/** Distinct UUIDs, at most `max`; null for anything else. */
function uuids(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null
  if (!value.every((id) => typeof id === "string" && UUID.test(id))) return null
  return new Set(value).size === value.length ? (value as string[]) : null
}

// Read straight from the RPC, not through the server's services, to see the
// database's code: a missing function is the B01 surface, not a failure.
async function read<K extends KnowledgeRpcName, T>(
  actor: MediaActor,
  fn: K,
  args: KnowledgeRpcs[K]["args"],
  context: string,
  parse: (data: unknown) => T | null
): Promise<WorkRead<T>> {
  const { data, error } = await knowledgeRpc(actor.db, fn, args)
  if (error) {
    if (MISSING_FUNCTION.has(error.code ?? "")) return { status: "missing" }
    return { status: "failed", failure: knowledgeRpcFailure(error, context) }
  }
  const value = parse(data)
  return value === null
    ? { status: "failed", failure: UNREADABLE }
    : { status: "ok", value }
}

export type WorkServices = {
  /** R8. An admin names the venue; everyone else gets their own. */
  getCapabilities(
    actor: MediaActor,
    venueId?: string | null
  ): Promise<WorkRead<VenueCapabilities>>
  /** R1. */
  getLabelWork(actor: MediaActor): Promise<WorkRead<LabelWork>>
  /** R3. */
  getTriage(
    actor: MediaActor,
    venueId?: string | null
  ): Promise<WorkRead<TriageRow[]>>
  /** R5. The caller's photos, task sends and findings, 20 a page. */
  getContributions(
    actor: MediaActor,
    cursor?: string | null
  ): Promise<WorkRead<ContributionsFeedPage>>
  /** R9. The uploader's own photo only. */
  getDeleteImpact(
    actor: MediaActor,
    assetId: string
  ): Promise<WorkRead<DeleteImpact>>
  /**
   * W1. Starts the caller's group of photos of one subject, or returns the
   * one already started with `key` (a retry never makes two).
   */
  startGroup(
    actor: MediaActor,
    input: { key: string; subject: GroupSubjectRef }
  ): Promise<WorkRead<{ groupId: string }>>
  /** W1. Adds the caller's own photos (1–10, any upload state); safe to repeat. */
  addToGroup(
    actor: MediaActor,
    input: { groupId: string; assetIds: string[] }
  ): Promise<WorkRead<{ members: number }>>
  /** W1. The group of each listed photo the caller may already see (≤ 100). */
  getAssetGroups(
    actor: MediaActor,
    assetIds: string[]
  ): Promise<WorkRead<AssetGroup[]>>
  /**
   * B05-m5. One group as the caller may see it: per-member states and the
   * summary for its creator, the venue's manager and admins; members and
   * the creator's first name for colleagues.
   */
  getGroup(
    actor: MediaActor,
    groupId: string
  ): Promise<WorkRead<ContributionGroupView>>
  /**
   * B05-m5. The creator replaces a failed, stopped or deleted member with a
   * new upload of their own, one for one; safe to repeat with the same pair.
   */
  replaceInGroup(
    actor: MediaActor,
    input: { groupId: string; failedAssetId: string; newAssetId: string }
  ): Promise<WorkRead<ContributionGroupReplaceResult>>
}

export const workServices: WorkServices = {
  getCapabilities: (actor, venueId = null) =>
    read(
      actor,
      "my_venue_capabilities",
      { p_venue_id: venueId },
      "venue capabilities",
      parseCapabilities
    ),

  getLabelWork: (actor) =>
    read(actor, "my_label_work", {}, "label work", parseLabelWork),

  getTriage: (actor, venueId = null) =>
    read(
      actor,
      "manager_triage_summary",
      { p_venue_id: venueId },
      "manager triage",
      parseTriage
    ),

  async getContributions(actor, cursor = null) {
    if (cursor !== null && (typeof cursor !== "string" || cursor.length > 512))
      return {
        status: "failed",
        failure: {
          ok: false,
          code: "invalid_input",
          status: 400,
          message: "This list couldn't be continued. Reload the page.",
        },
      }
    const page = await read(
      actor,
      "my_contributions_feed",
      { p_cursor: cursor, p_limit: CONTRIBUTIONS_PAGE },
      "my contributions",
      parseContributionsPage
    )
    return page.status === "ok"
      ? { status: "ok", value: await withGroupIds(actor, page.value) }
      : page
  },

  async getDeleteImpact(actor, assetId) {
    if (!UUID.test(assetId))
      return {
        status: "failed",
        failure: {
          ok: false,
          code: "not_found",
          status: 404,
          message: "This photo could not be found. It may have been deleted.",
        },
      }
    return read(
      actor,
      "my_asset_delete_impact",
      { p_asset_id: assetId },
      "delete impact",
      parseDeleteImpact
    )
  },

  startGroup(actor, input) {
    const subject = input?.subject
    const kind = subject?.kind
    const id = subject?.id ?? null
    if (
      typeof input?.key !== "string" ||
      !GROUP_KEY.test(input.key) ||
      !GROUP_SUBJECT_KINDS.includes(kind as GroupSubjectKind) ||
      (kind === "none" ? id !== null : typeof id !== "string" || !UUID.test(id))
    )
      return Promise.resolve(INVALID_GROUP)
    return read(
      actor,
      "contribution_group_start",
      {
        p_key: input.key,
        p_subject_kind: kind as GroupSubjectKind,
        p_subject_id: id,
      },
      "contribution group start",
      parseGroupId
    )
  },

  addToGroup(actor, input) {
    const assetIds = uuids(input?.assetIds, GROUP_LIMITS.maxMembers)
    if (
      typeof input?.groupId !== "string" ||
      !UUID.test(input.groupId) ||
      !assetIds ||
      assetIds.length === 0
    )
      return Promise.resolve(INVALID_GROUP)
    return read(
      actor,
      "contribution_group_add",
      { p_group_id: input.groupId, p_asset_ids: assetIds },
      "contribution group add",
      parseGroupMembers
    )
  },

  async getAssetGroups(actor, assetIds) {
    const ids = uuids(assetIds, GROUP_LIMITS.maxLookup)
    if (!ids) return INVALID_GROUP
    if (ids.length === 0) return { status: "ok", value: [] }
    return read(
      actor,
      "contribution_groups_for_assets",
      { p_asset_ids: ids },
      "contribution groups",
      parseAssetGroups
    )
  },

  getGroup(actor, groupId) {
    if (typeof groupId !== "string" || !UUID.test(groupId))
      return Promise.resolve(INVALID_GROUP)
    return read(
      actor,
      "contribution_group",
      { p_group_id: groupId },
      "contribution group",
      parseGroupView
    )
  },

  replaceInGroup(actor, input) {
    const ids = uuids(
      [input?.groupId, input?.failedAssetId, input?.newAssetId],
      3
    )
    if (!ids || ids.length !== 3) return Promise.resolve(INVALID_GROUP)
    const [groupId, failedAssetId, newAssetId] = ids as [string, string, string]
    return read(
      actor,
      "contribution_group_replace",
      {
        p_group_id: groupId,
        p_failed_asset_id: failedAssetId,
        p_new_asset_id: newAssetId,
      },
      "contribution group replace",
      parseGroupReplace
    )
  },
}

/**
 * Photo rows gain their contribution group (W1). A lookup that is missing or
 * fails leaves groupId out rather than failing the page.
 */
async function withGroupIds(
  actor: MediaActor,
  page: ContributionsFeedPage
): Promise<ContributionsFeedPage> {
  const photos = [
    ...new Set(
      page.items.flatMap((item) =>
        item.type === "photo" ? [item.assetId] : []
      )
    ),
  ].filter((id) => UUID.test(id))
  if (photos.length === 0 || photos.length > GROUP_LIMITS.maxLookup) return page
  const groups = await workServices
    .getAssetGroups(actor, photos)
    .catch(() => null)
  if (groups?.status !== "ok") return page
  const byAsset = new Map(groups.value.map((g) => [g.assetId, g.groupId]))
  return {
    ...page,
    items: page.items.map((item) =>
      item.type === "photo"
        ? { ...item, groupId: byAsset.get(item.assetId) ?? null }
        : item
    ),
  }
}
