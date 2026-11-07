import "server-only"

// Placeholder implementations with the final signatures. Replaced by the
// amenity services; every call fails as unavailable until then.

import type {
  AmenityFailure,
  AmenityResult,
  AmenityServices,
} from "@/lib/amenities/contract"
import type { MediaActor } from "@/lib/server/media/types"

type Service<K extends keyof AmenityServices> = (
  actor: MediaActor,
  input: unknown
) => ReturnType<AmenityServices[K]>

const UNAVAILABLE: AmenityFailure = {
  ok: false,
  code: "unavailable",
  status: 503,
  message: "Amenities are not available yet.",
}

function stub<K extends keyof AmenityServices>(): Service<K> {
  return (async () => UNAVAILABLE) as unknown as Service<K>
}

export const getVenueAmenities = stub<"getVenueAmenities">()
export const listCatalogue = stub<"listCatalogue">()
export const getCheck = stub<"getCheck">()
export const getMyAmenityTasks = stub<"getMyAmenityTasks">()
export const listSubmittableAssets = stub<"listSubmittableAssets">()
export const enableAmenities = stub<"enableAmenities">()
export const addChecks = stub<"addChecks">()
export const archiveCheck = stub<"archiveCheck">()
export const restoreCheck = stub<"restoreCheck">()
export const assignCheck = stub<"assignCheck">()
export const setCheckNotes = stub<"setCheckNotes">()
export const reopenCheck = stub<"reopenCheck">()
export const submitFinding = stub<"submitFinding">()

export type { AmenityResult }
