// Coverage services. Every function derives the actor from auth and re-reads
// its scope; the database re-checks inside each transaction. DTOs and inputs
// live in ./types (type-only, safe to import from client components).

export { getCoverageActor, getCoverageScope } from "./context"
export {
  getMyAssignment,
  getMyMonth,
  getMyTasks,
  listMySubmittablePhotos,
  submitPhotos,
} from "./staff"
export {
  getStaffMonth,
  getVenueCoverage,
  getVenueRequirement,
  getVenueRoster,
  listReviewQueue,
  listVenuePhotos,
} from "./venue"
export { attachPhotos, reviewSubmission } from "./review"
export {
  createRequirement,
  listAmenityFacts,
  listCoverageTemplates,
  setAmenityFact,
  setMonthlyTarget,
  setRequirementAssignees,
  setRequirementStatus,
  updateRequirement,
} from "./config"
export {
  confirmMenuCoverage,
  discardMenuCoverage,
  getMenuCoverage,
  reconcileMenuRequirement,
  startMenuCoverage,
} from "./menu"
export {
  getGroupOverview,
  grantVenueManager,
  listGrantCandidates,
  listManagerGrants,
  listPreparationRuns,
  listSelfReviews,
  revokeVenueManager,
} from "./admin"
export {
  getPreparationStatus,
  prepareMonth,
  runScheduledPreparation,
} from "./preparation"
export { signEvidence } from "./evidence"
