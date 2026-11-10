import "server-only"

import type { ToConfirmItem } from "@/lib/knowledge/contract"
import * as server from "@/lib/server/knowledge"
import { knowledgeInvalid } from "@/lib/server/knowledge/errors"
import { knowledgeRpc } from "@/lib/server/knowledge/rpc"
import { isObject, isUuid, parseCheckId } from "@/lib/server/knowledge/validate"
import type { MediaActor } from "@/lib/server/media/types"

import {
  adaptCheck,
  adaptDecision,
  adaptDraft,
  adaptFindingsPage,
  adaptSubmitted,
  adaptToConfirm,
  adaptWorkingList,
} from "./adapt"
import type {
  DecideInput,
  DecisionResult,
  FindingsPage,
  KnowledgeAsset,
  KnowledgeFailure,
  KnowledgeResult,
  MyPending,
  QuestionView,
  ResolveConflictInput,
  SaveDraftInput,
  ServerDraft,
  SubmitKnowledgeInput,
  SubmittedFinding,
  ToConfirmList,
  WorkingList,
} from "./contract"

/**
 * The server operations the knowledge screens call (S1-S14), each with the
 * authorised actor and untrusted input, answering in the screens' view models.
 * Unit tests mock this seam.
 */
export type KnowledgeServices = {
  /** Null when the caller has no current venue. */
  getWorkingList(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<{ view: WorkingList | null }>>
  /** `input`: `{ checkId, venueName }`; the venue name is the page's. */
  getKnowledgeCheck(
    actor: MediaActor,
    input: { checkId: string; venueName: string }
  ): Promise<KnowledgeResult<{ view: QuestionView }>>
  submitKnowledgeFinding(
    actor: MediaActor,
    input: SubmitKnowledgeInput | unknown
  ): Promise<KnowledgeResult<SubmittedFinding>>
  saveDraft(
    actor: MediaActor,
    input: SaveDraftInput | unknown
  ): Promise<KnowledgeResult<{ draftRevision: number; savedAt: string }>>
  getDraft(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<{ draft: ServerDraft | null }>>
  discardDraft(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<Record<never, never>>>
  listMyFindings(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<{ page: FindingsPage }>>
  listToConfirm(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<{ view: ToConfirmList }>>
  decide(
    actor: MediaActor,
    input: DecideInput | unknown
  ): Promise<KnowledgeResult<DecisionResult>>
  resolveConflict(
    actor: MediaActor,
    input: ResolveConflictInput | unknown
  ): Promise<KnowledgeResult<DecisionResult>>
  dismissClosedAssignment(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<Record<never, never>>>
  getMyPending(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<{ pending: MyPending }>>
  /** Staff only: own attachable media on a working-list question (F1). */
  listKnowledgeAssets(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<{ assets: KnowledgeAsset[] }>>
}

/** PostgREST and Postgres "no such function": the schema predates B01. */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"])

const DECIDE = {
  confirm: server.confirmFinding,
  reaffirm: server.reaffirmAnswer,
  request_detail: server.requestMoreDetail,
  decline: server.declineFinding,
  seen: server.markUnknownSeen,
} as const

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null

/**
 * To confirm, read here rather than through server.listToConfirm for the same
 * reason as the working list: before the migrations nothing waits, as on
 * main, rather than a list that couldn't be loaded.
 */
async function readToConfirm(
  actor: MediaActor,
  venueId: string | null
): Promise<KnowledgeResult<{ count: number; items: ToConfirmItem[] }>> {
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_to_confirm", {
    p_venue_id: venueId,
  })
  if (error) {
    if (MISSING_FUNCTION.has(error.code ?? ""))
      return { ok: true, count: 0, items: [] }
    return server.knowledgeRpcFailure(error, "knowledge to confirm")
  }
  return { ok: true, count: data.count, items: data.items }
}

const UNKNOWN_DECISION: KnowledgeFailure = {
  ok: false,
  code: "invalid_input",
  status: 400,
  message: "This action isn't available here. Reload the page.",
  fieldErrors: {
    decision: "This action isn't available here. Reload the page.",
  },
}

export const knowledgeServices: KnowledgeServices = {
  async getWorkingList(actor) {
    // Read here, not through server.getWorkingList, to see the database's
    // code: before the B01 migrations the function doesn't exist, and that
    // is no working list (Home as on main), not a failed read (M3).
    const { data, error } = await knowledgeRpc(
      actor.db,
      "knowledge_working_list",
      {}
    )
    if (error) {
      if (MISSING_FUNCTION.has(error.code ?? ""))
        return { ok: true, view: null }
      return server.knowledgeRpcFailure(error, "knowledge working list")
    }
    return { ok: true, view: adaptWorkingList(data) }
  },

  async getKnowledgeCheck(actor, input) {
    const checkId = parseCheckId({ checkId: input.checkId })
    if (!checkId.ok) return checkId
    // Read here for the database's code, as the working list: before the
    // migrations no question is on a working list, so the page behaves as on
    // main (not in scope) instead of failing.
    const { data: check, error } = await knowledgeRpc(
      actor.db,
      "knowledge_check",
      { p_check_id: checkId.value }
    )
    if (error) {
      if (MISSING_FUNCTION.has(error.code ?? ""))
        return { ok: true, view: { inScope: false } }
      return server.knowledgeRpcFailure(error, "knowledge check")
    }
    // Answers in use that need a decision are listed for deciders only.
    const toConfirm =
      check.inScope && check.permissions.canConfirm
        ? await readToConfirm(actor, check.venueId)
        : null
    return {
      ok: true,
      view: adaptCheck(
        check,
        input.venueName,
        toConfirm?.ok ? toConfirm.items : []
      ),
    }
  },

  async submitKnowledgeFinding(actor, input) {
    const result = await server.submitKnowledgeFinding(actor, input)
    return result.ok ? { ok: true, ...adaptSubmitted(result) } : result
  },

  saveDraft: (actor, input) => server.saveDraft(actor, input),

  async getDraft(actor, input) {
    const result = await server.getDraft(actor, input)
    if (!result.ok) return result
    return { ok: true, draft: result.draft ? adaptDraft(result.draft) : null }
  },

  async discardDraft(actor, input) {
    const result = await server.discardDraft(actor, input)
    return result.ok ? { ok: true } : result
  },

  async listMyFindings(actor, input) {
    const result = await server.listMyFindings(actor, input)
    if (!result.ok) return result
    // Drafts carry their own names; a closed assignment borrows its venue's
    // name from another row of the page.
    const known = new Map<string, { question: string; venueName: string }>()
    for (const item of [...result.page.drafts, ...result.page.items])
      if ("venueName" in item && !known.has(item.checkId))
        known.set(item.checkId, {
          question: item.question,
          venueName: item.venueName,
        })
    return { ok: true, page: adaptFindingsPage(result.page, known) }
  },

  async listToConfirm(actor, input) {
    const venueId = isObject(input) ? (input.venueId ?? null) : null
    if (venueId !== null && !isUuid(venueId))
      return knowledgeInvalid({ venueId: "Choose a venue." })
    const result = await readToConfirm(actor, venueId)
    if (!result.ok) return result
    return { ok: true, view: adaptToConfirm(result.items, result.count) }
  },

  async decide(actor, input) {
    const decision = isRecord(input) ? input.decision : null
    const run =
      typeof decision === "string" && decision in DECIDE
        ? DECIDE[decision as keyof typeof DECIDE]
        : null
    if (!run) return UNKNOWN_DECISION
    const result = await run(actor, input)
    return result.ok ? { ok: true, ...adaptDecision(result) } : result
  },

  async resolveConflict(actor, input) {
    const result = await server.resolveConflict(actor, input)
    return result.ok ? { ok: true, ...adaptDecision(result) } : result
  },

  async dismissClosedAssignment(actor, input) {
    const result = await server.dismissClosedAssignment(actor, input)
    return result.ok ? { ok: true } : result
  },

  getMyPending: (actor, input) => server.getMyPending(actor, input),

  listKnowledgeAssets: (actor, input) =>
    server.listKnowledgeAssets(actor, input),
}
