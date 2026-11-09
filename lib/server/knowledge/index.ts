import "server-only"

// Knowledge services (docs/knowledge/b01-design.md §13). Each takes the
// authorised actor and untrusted input, checks its shape, and calls one
// caller-scoped RPC; the database decides role, venue, scope and outcome.
// S12 (reopen) is the existing amenities `reopenCheck`; S14 targets come
// from the existing coverage progress read.

export { getAmenityActor as getKnowledgeActor } from "@/lib/server/amenities/context"
export {
  getDraft,
  getKnowledgeCheck,
  getMyPending,
  getPilotPreview,
  getWorkingList,
  listMyFindings,
  listToConfirm,
} from "./reads"
export {
  confirmFinding,
  declineFinding,
  discardDraft,
  dismissClosedAssignment,
  markUnknownSeen,
  reaffirmAnswer,
  requestMoreDetail,
  resolveConflict,
  revokeConfirmation,
  saveDraft,
  setWorkingList,
  submitKnowledgeFinding,
} from "./writes"
export { readKnowledgeAnswers, type KnowledgeReaderResult } from "./reader"
export { knowledgeRpcFailure } from "./errors"
