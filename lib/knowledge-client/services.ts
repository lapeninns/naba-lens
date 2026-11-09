import "server-only"

import type { MediaActor } from "@/lib/server/media/types"

import type {
  DecideInput,
  DecisionResult,
  KnowledgeCheckView,
  KnowledgeFailure,
  KnowledgeResult,
  MyFindingsPage,
  MyPending,
  ResolveConflictInput,
  SaveDraftInput,
  ServerDraft,
  SubmitKnowledgeInput,
  SubmitKnowledgeResult,
  ToConfirmView,
  WorkingListView,
} from "./contract"

/**
 * The server operations the knowledge screens call (WS1 S1-S14), each with
 * the authorised actor and untrusted input, like the amenity services.
 */
export type KnowledgeServices = {
  getWorkingList(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<{ view: WorkingListView }>>
  getKnowledgeCheck(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<{ view: KnowledgeCheckView }>>
  submitKnowledgeFinding(
    actor: MediaActor,
    input: SubmitKnowledgeInput | unknown
  ): Promise<KnowledgeResult<SubmitKnowledgeResult>>
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
  ): Promise<KnowledgeResult<{ page: MyFindingsPage }>>
  listToConfirm(
    actor: MediaActor,
    input: unknown
  ): Promise<KnowledgeResult<{ view: ToConfirmView }>>
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
}

const OUT_OF_SCOPE: KnowledgeFailure = {
  ok: false,
  code: "knowledge_slot_out_of_scope",
  status: 409,
  message: "This question isn't on the question list.",
}

/**
 * Until the knowledge server layer is available, no question is on a working
 * list: reads report nothing in scope and every write is refused as out of
 * scope, so every screen keeps its legacy behaviour.
 */
const NOT_ENABLED: KnowledgeServices = {
  getWorkingList: async () => OUT_OF_SCOPE,
  getKnowledgeCheck: async () => ({ ok: true, view: { inScope: false } }),
  submitKnowledgeFinding: async () => OUT_OF_SCOPE,
  saveDraft: async () => OUT_OF_SCOPE,
  getDraft: async () => ({ ok: true, draft: null }),
  discardDraft: async () => ({ ok: true }),
  listMyFindings: async () => ({
    ok: true,
    page: { items: [], nextCursor: null, hiddenEarlierVenues: [] },
  }),
  listToConfirm: async () => ({ ok: true, view: { items: [], count: 0 } }),
  decide: async () => OUT_OF_SCOPE,
  resolveConflict: async () => OUT_OF_SCOPE,
  dismissClosedAssignment: async () => ({ ok: true }),
  getMyPending: async () => ({
    ok: true,
    pending: { awaitingConfirmation: 0, unknownRecorded: 0 },
  }),
}

export const knowledgeServices: KnowledgeServices = NOT_ENABLED
