"use server"

// Placeholder actions with the final signatures; replaced by the amenity
// services work. Every argument is untrusted.

import type { AmenityFailure, AmenityServices } from "@/lib/amenities/contract"

const UNAVAILABLE: AmenityFailure = {
  ok: false,
  code: "unavailable",
  status: 503,
  message: "Amenities are not available yet.",
}

type Action<K extends keyof AmenityServices> = (
  input: unknown
) => ReturnType<AmenityServices[K]>

const pending = async () => UNAVAILABLE

export const enableAmenitiesAction: Action<"enableAmenities"> = pending
export const addChecksAction: Action<"addChecks"> = pending
export const archiveCheckAction: Action<"archiveCheck"> = pending
export const restoreCheckAction: Action<"restoreCheck"> = pending
export const assignCheckAction: Action<"assignCheck"> = pending
export const setCheckNotesAction: Action<"setCheckNotes"> = pending
export const reopenCheckAction: Action<"reopenCheck"> = pending
export const submitFindingAction: Action<"submitFinding"> = pending
export const listCatalogueAction: Action<"listCatalogue"> = pending
export const listSubmittableAssetsAction: Action<"listSubmittableAssets"> =
  pending
export const getCheckAction: Action<"getCheck"> = pending
