import "server-only"

// Knowledge services (docs/knowledge/b01-design.md §13). Each takes the
// authorised actor and untrusted input, checks its shape, and calls one
// caller-scoped RPC; the database decides role, venue, scope and outcome.
// S12 (reopen) is the existing amenities `reopenCheck`; S14 targets come
// from the existing coverage progress read.

export { getAmenityActor as getKnowledgeActor } from "@/lib/server/amenities/context"
export {
  getAssetDeleteImpact,
  getDraft,
  getKnowledgeCheck,
  getLabelWork,
  getManagerTriage,
  getMyPending,
  getPilotPreview,
  getVenueCapabilities,
  getWorkingList,
  listKnowledgeAssets,
  listMyContributions,
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
export {
  addToContributionGroup,
  getContributionGroup,
  listGroupsForAssets,
  startContributionGroup,
} from "./groups"
export {
  getKnowledgeQuestion,
  getValueList,
  listQuestionRegistry,
} from "./registry"
export { addPlace, listPlaces, retirePlace } from "./places"
export {
  addScheduleException,
  getOccurrences,
  previewSchedule,
} from "./schedule-services"
export { expandScheduleOccurrences } from "./schedules"
export { readKnowledgeAnswers, type KnowledgeReaderResult } from "./reader"
export { knowledgeRpcFailure } from "./errors"
