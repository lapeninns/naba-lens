import "server-only"

// B04-e server functions (b04-design §8.4; task B04-05): import dry runs over
// a recorded and crosswalked snapshot, per-line review of trading proposals,
// trading releases and activation with a release. Admin commands (OD-B4-11
// default). Each acts as the caller; the SECURITY DEFINER RPCs re-read the
// profile. Expected failures are Outcome values, as in trading.ts.

import type { MediaActor, Outcome } from "@/lib/server/media/types"

import { menuRpcFailure, type MenuFailure } from "./errors"
import { isUuid } from "./validate"

type DbError = {
  message?: string
  code?: string
  details?: string | null
} | null

/** The B04-e RPCs are not in the generated types until the next regeneration. */
type ImportsRpc = {
  rpc(
    fn:
      | "menu_import_dry_run"
      | "menu_import_apply"
      | "menu_trading_proposal_decide"
      | "menu_trading_proposals_accept_exact"
      | "menu_release_confirm"
      | "menu_activate_with_release"
      | "menu_import_run",
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: DbError }>
}

const call = (actor: MediaActor) => actor.db as unknown as ImportsRpc

const fail = (status: MenuFailure["status"], message: string): MenuFailure => ({
  ok: false,
  status,
  message,
})

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

const RETRY_KEY = "This request is invalid. Reload the page and try again."
const HASH = /^[0-9a-f]{64}$/

export const PROPOSAL_DECISIONS = ["accepted", "edited", "rejected"] as const
export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number]

const CODES: Record<string, [MenuFailure["status"], string]> = {
  not_active_admin: [403, "Only an admin can do this."],
  menu_snapshot_not_found: [404, "This menu source copy could not be found."],
  crosswalk_not_run: [
    409,
    "Match this source copy against the menu (crosswalk) before comparing it.",
  ],
  menu_import_run_not_found: [404, "This comparison could not be found."],
  menu_import_already_applied: [
    409,
    "This comparison has already been applied.",
  ],
  import_base_changed: [
    409,
    "The menu or its prices changed since this comparison, or it is more than a day old. Compare again.",
  ],
  menu_import_draft_mismatch: [
    409,
    "Choose a draft made from the menu this comparison was made against.",
  ],
  menu_trading_proposal_not_found: [404, "This price line could not be found."],
  invalid_proposal_decision: [400, "Choose accept, edit or reject."],
  invalid_price: [
    400,
    'Enter the price in pounds and pence, for example 10.50. Prices such as "from 9.95" or "MP" cannot be accepted.',
  ],
  menu_trading_proposal_unmapped: [
    409,
    "This line is not matched to a dish yet. Review its match first, or reject it.",
  ],
  menu_trading_proposal_immutable: [
    409,
    "This price release is already live; its lines can no longer change.",
  ],
  menu_release_not_found: [404, "This price release could not be found."],
  menu_release_not_draft: [409, "This price release can no longer change."],
  menu_release_stale: [
    409,
    "The price lines changed since they were checked. Review and confirm them again.",
  ],
  menu_release_item_not_on_version: [
    409,
    "A priced dish is not on this menu version.",
  ],
  menu_release_not_confirmed: [409, "Confirm the price release first."],
  menu_release_wrong_version: [
    409,
    "This price release belongs to another menu version.",
  ],
  menu_trading_line_retired: [409, "A priced option is no longer on the menu."],
}

/** Maps by message (= code), then falls back to the catalogue mapping. */
export function importsRpcFailure(
  error: DbError,
  context: string
): MenuFailure {
  const message = error?.message ?? ""
  if (message === "menu_trading_conflict")
    return fail(409, "This line changed elsewhere. Reload and decide again.")
  if (message in CODES) {
    const [status, text] = CODES[message]!
    return fail(status, text)
  }
  return menuRpcFailure(error, `imports ${context}`)
}

type Result = Record<string, unknown> & { replayed: boolean }

async function run(
  actor: MediaActor,
  fn: Parameters<ImportsRpc["rpc"]>[0],
  args: Record<string, unknown>,
  context: string
): Promise<Outcome<{ result: Result }>> {
  const { data, error } = await call(actor).rpc(fn, args)
  if (error) return importsRpcFailure(error, context)
  if (!isObject(data)) return importsRpcFailure(null, `${context} (no result)`)
  return {
    ok: true,
    result: { ...data, replayed: data.replayed === true } as Result,
  }
}

/** The comparison report and proposals, or `already_imported` with the run. */
export async function importDryRun(
  actor: MediaActor,
  input: { snapshotId: string; requestKey: string }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.snapshotId))
    return fail(404, CODES.menu_snapshot_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  return run(
    actor,
    "menu_import_dry_run",
    { p_snapshot: input.snapshotId, p_request_key: input.requestKey },
    "dry run"
  )
}

export async function importApply(
  actor: MediaActor,
  input: { runId: string; draftVersionId: string; requestKey: string }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.runId))
    return fail(404, CODES.menu_import_run_not_found![1])
  if (!isUuid(input.draftVersionId))
    return fail(409, CODES.menu_import_draft_mismatch![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  return run(
    actor,
    "menu_import_apply",
    {
      p_run: input.runId,
      p_draft_version: input.draftVersionId,
      p_request_key: input.requestKey,
    },
    "apply"
  )
}

export async function decideTradingProposal(
  actor: MediaActor,
  input: {
    proposalId: string
    expectedRevision: number
    decision: ProposalDecision
    amount?: string | null
    requestKey: string
  }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.proposalId))
    return fail(404, CODES.menu_trading_proposal_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1)
    return fail(400, "Reload the line and try again.")
  if (!(PROPOSAL_DECISIONS as readonly string[]).includes(input.decision))
    return fail(400, CODES.invalid_proposal_decision![1])
  const edited = input.decision === "edited"
  if (
    edited !== (typeof input.amount === "string" && input.amount.trim() !== "")
  )
    return fail(400, CODES.invalid_price![1])
  return run(
    actor,
    "menu_trading_proposal_decide",
    {
      p_proposal: input.proposalId,
      p_expected_revision: input.expectedRevision,
      p_decision: input.decision,
      p_value: edited ? { amount: input.amount!.trim() } : null,
      p_request_key: input.requestKey,
    },
    "proposal decide"
  )
}

export async function acceptExactProposals(
  actor: MediaActor,
  input: { runId: string; requestKey: string }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.runId))
    return fail(404, CODES.menu_import_run_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  return run(
    actor,
    "menu_trading_proposals_accept_exact",
    { p_run: input.runId, p_request_key: input.requestKey },
    "accept exact"
  )
}

export async function confirmRelease(
  actor: MediaActor,
  input: { releaseId: string; expectedHash: string; requestKey: string }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.releaseId))
    return fail(404, CODES.menu_release_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  if (typeof input.expectedHash !== "string" || !HASH.test(input.expectedHash))
    return fail(409, CODES.menu_release_stale![1])
  return run(
    actor,
    "menu_release_confirm",
    {
      p_release: input.releaseId,
      p_expected_hash: input.expectedHash,
      p_request_key: input.requestKey,
    },
    "release confirm"
  )
}

export async function activateWithRelease(
  actor: MediaActor,
  input: {
    versionId: string
    expectedRevision: number
    releaseId: string
    requestKey: string
  }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.versionId))
    return fail(404, "This menu version could not be found.")
  if (!isUuid(input.releaseId))
    return fail(404, CODES.menu_release_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1)
    return fail(400, "Reload the page and try again.")
  return run(
    actor,
    "menu_activate_with_release",
    {
      p_version: input.versionId,
      p_expected_revision: input.expectedRevision,
      p_release: input.releaseId,
      p_request_key: input.requestKey,
    },
    "activate with release"
  )
}

/** A dry run's report, proposals and release (admin). */
export async function importRun(
  actor: MediaActor,
  runId: string
): Promise<Outcome<{ run: Record<string, unknown> }>> {
  if (!isUuid(runId)) return fail(404, CODES.menu_import_run_not_found![1])
  const { data, error } = await call(actor).rpc("menu_import_run", {
    p_run: runId,
  })
  if (error) return importsRpcFailure(error, "run")
  if (!isObject(data) || !Array.isArray(data.proposals))
    return importsRpcFailure(null, "run (no proposals)")
  return { ok: true, run: data }
}
