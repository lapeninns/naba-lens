/**
 * NabaLens media limits (spec v0.2 §5). These are chosen product defaults, not
 * hosting allowances. This file is the only place the limits are defined; server
 * routes enforce them and the client uses them for early feedback only.
 */

const MiB = 1024 * 1024

export const MEDIA_LIMITS = {
  /** Files a staff member can add to one upload batch. */
  maxBatchFiles: 10,
  /** Simultaneous transfers per batch. */
  maxParallelUploads: 2,
  /** Largest photo original, in bytes (20 MiB). */
  maxPhotoBytes: 20 * MiB,
  /** Largest video original, in bytes (200 MiB). */
  maxVideoBytes: 200 * MiB,
  /** Largest avatar upload before the server makes its derivative (5 MiB). */
  maxAvatarBytes: 5 * MiB,
  /** Lifetime of newly issued signed read URLs, in seconds. */
  signedUrlExpirySeconds: 60,
  /** Assets per gallery page (cursor pagination on created_at + id). */
  pageSize: 24,
  /** Reservations untouched for this long are abandoned and cleaned up (24 h). */
  abandonedUploadWindowHours: 24,
} as const

export type MediaLimits = typeof MEDIA_LIMITS

/** The abandoned window as a Postgres interval for `prepare_media_cleanup`. */
export function abandonedUploadInterval(
  limits: Pick<MediaLimits, "abandonedUploadWindowHours"> = MEDIA_LIMITS
): string {
  return `${limits.abandonedUploadWindowHours} hours`
}

export function maxBytesFor(
  kind: "image" | "video",
  limits: Pick<MediaLimits, "maxPhotoBytes" | "maxVideoBytes"> = MEDIA_LIMITS
): number {
  return kind === "image" ? limits.maxPhotoBytes : limits.maxVideoBytes
}
