import "server-only"

import type {
  FreshnessPolicyView,
  FreshnessPreviewView,
  KnowledgeResult,
  RecheckTaskView,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

import { knowledgeInvalid, knowledgeRpcFailure } from "./errors"
import { knowledgeRpc } from "./rpc"
import { isObject, isUuid, NOT_FOUND, optionalVenueId } from "./validate"

// Recheck tasks and freshness (B03-e, b03-design §7, A11). Tasks are opened
// by the hourly job and closed when the answer reads current again; these
// reads list them. The freshness preview is an admin dry run.

const KEY = /^[a-z0-9_]{1,40}$/
const POLICY = /^[a-z][a-z0-9_]{0,39}$/

/** The caller's open tasks: on checks assigned to them at their venue. */
export async function listMyRechecks(
  actor: MediaActor
): Promise<KnowledgeResult<{ tasks: RecheckTaskView[] }>> {
  const { data, error } = await knowledgeRpc(actor.db, "my_rechecks", {})
  if (error) return knowledgeRpcFailure(error, "my rechecks")
  return { ok: true, tasks: data.items }
}

/**
 * One check's open tasks. Managers, admins and the assignee get the tasks;
 * other staff only the count.
 */
export async function getCheckRechecks(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ count: number; tasks: RecheckTaskView[] }>> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_check_rechecks",
    { p_check_id: input.checkId }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge check rechecks")
  return { ok: true, count: data.count, tasks: data.items }
}

/**
 * A41: every open task at the venue, for managers and admins (the triage
 * row's gate; staff are refused), oldest due first. The same tasks the triage
 * rechecks row counts. The assignee is the check's.
 */
export async function listVenueRechecks(
  actor: MediaActor,
  input: unknown = {}
): Promise<
  KnowledgeResult<{ venueId: string; count: number; tasks: RecheckTaskView[] }>
> {
  const venueId = optionalVenueId(input)
  if (!venueId.ok) return venueId
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_venue_rechecks",
    { p_venue_id: venueId.value }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge venue rechecks")
  return {
    ok: true,
    venueId: data.venueId,
    count: data.count,
    tasks: data.items,
  }
}

/**
 * A42, admins only: the latest version of each freshness policy per use, the
 * version the preview uses. Empty until OD-15 supplies policies.
 */
export async function listFreshnessPolicies(
  actor: MediaActor
): Promise<KnowledgeResult<{ policies: FreshnessPolicyView[] }>> {
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_freshness_policies",
    {}
  )
  if (error) return knowledgeRpcFailure(error, "knowledge freshness policies")
  return { ok: true, policies: data.items }
}

/** Admin, no write: what naming these policies for a key would do (§7.3). */
export async function previewFreshness(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ preview: FreshnessPreviewView }>> {
  if (!isObject(input) || typeof input.key !== "string" || !KEY.test(input.key))
    return knowledgeInvalid({ key: "Choose a question." })
  const policy = input.policy
  const valid = (v: unknown) =>
    v === undefined || v === null || (typeof v === "string" && POLICY.test(v))
  if (
    !isObject(policy) ||
    Object.keys(policy).some((k) => k !== "internal" && k !== "public") ||
    !valid(policy.internal) ||
    !valid(policy.public)
  )
    return knowledgeInvalid({ policy: "Choose a policy for each use." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_freshness_preview",
    {
      p_key: input.key,
      p_policy: {
        internal: (policy.internal as string | null | undefined) ?? null,
        public: (policy.public as string | null | undefined) ?? null,
      },
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge freshness preview")
  return { ok: true, preview: data }
}
