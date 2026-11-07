import "server-only"

// Amenity services. Each takes the authorised actor and untrusted input,
// validates the input, re-reads the caller's scope where it decides a venue,
// and calls one or more caller-scoped RPCs; the database re-checks role and
// venue inside every call. DTOs and inputs live in lib/amenities/contract.

import type { AmenityResult } from "@/lib/amenities/contract"

export { getAmenityActor } from "./context"
export {
  getCheck,
  getMyAmenityTasks,
  getVenueAmenities,
  listCatalogue,
  listSubmittableAssets,
} from "./reads"
export {
  addChecks,
  archiveCheck,
  assignCheck,
  enableAmenities,
  reopenCheck,
  restoreCheck,
  setCheckNotes,
  submitFinding,
} from "./writes"
export { amenityVideo } from "./media"

export type { AmenityResult }
