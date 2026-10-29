// View-model types for NabaLens presentational components. Pages map database
// rows (see lib/db/types.ts) onto these; components never fetch data.

export type MediaType = "image" | "video"

/** Technical pipeline states. These are not editorial approval states. */
export type UploadState = "uploading" | "processing" | "ready" | "failed"

export type MediaItem = {
  id: string
  mediaType: MediaType
  uploadState: UploadState
  /** Short-lived signed URL for the cropped thumbnail, if one exists yet. */
  thumbnailUrl: string | null
  /** Short-lived signed URL for the full preview (image derivative or video original). */
  previewUrl: string | null
  /** Validated MIME type, used to check native video playback support. */
  mimeType: string | null
  originalFilename: string
  /** ISO 8601 timestamp of the upload. */
  createdAt: string
  contributorId: string
  contributorName: string
  /** Venue snapshotted at upload time, not the contributor's current venue. */
  venueName: string
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  sizeBytes?: number | null
}

export type Option = { id: string; name: string }

export type StaffStatus = "active" | "invited" | "inactive"

export type StaffMember = {
  id: string
  displayName: string
  avatarUrl: string | null
  jobTitle: string | null
  venueId: string | null
  venueName: string | null
  email?: string | null
  status: StaffStatus
}

/** Upload limits. Pass `MEDIA_LIMITS` from lib/config/media.ts; do not hard-code. */
export type UploadLimits = {
  maxBatchFiles: number
  maxParallelUploads: number
  maxPhotoBytes: number
  maxVideoBytes: number
}

/** Result a page's server action returns to a dialog. */
export type ActionResult =
  | { ok: true }
  | {
      ok: false
      /** Shown at the top of the form. */
      error: string
      fieldErrors?: Partial<Record<string, string>>
    }
