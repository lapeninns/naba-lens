import "server-only"

import type {
  KnowledgeFailure,
  KnowledgeRpcName,
  KnowledgeRpcs,
} from "@/lib/knowledge/contract"
import { knowledgeRpcFailure } from "@/lib/server/knowledge"
import { knowledgeRpc } from "@/lib/server/knowledge/rpc"
import type { MediaActor } from "@/lib/server/media/types"

import type {
  DeleteImpact,
  LabelWork,
  TriageRow,
  VenueCapabilities,
} from "./contract"
import {
  parseCapabilities,
  parseDeleteImpact,
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  /** R9. The uploader's own photo only. */
  getDeleteImpact(
    actor: MediaActor,
    assetId: string
  ): Promise<WorkRead<DeleteImpact>>
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
}
