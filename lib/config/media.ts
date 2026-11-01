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
  /**
   * Largest avatar upload before the server makes its derivative (4 MiB). Avatars
   * pass through a function, so file + multipart framing must stay under the
   * host's 4.5 MB request body limit (Vercel).
   */
  maxAvatarBytes: 4 * MiB,
  /** Lifetime of newly issued signed read URLs, in seconds. */
  signedUrlExpirySeconds: 60,
  /** Assets per gallery page (cursor pagination on created_at + id). */
  pageSize: 24,
  /** Reservations untouched for this long are abandoned and cleaned up (24 h). */
  abandonedUploadWindowHours: 24,
  /**
   * A finalise claim (`processing`) older than this is a crashed finalise, and
   * cleanup marks it `failed` so the uploader can retry or delete it. Must stay
   * well above the finalise route's maxDuration; the database requires >= 10.
   */
  staleProcessingMinutes: 30,

  // Server processing budgets used by lib/media (see docs/media-pipeline.md).
  /** Largest decoded image, in pixels (width x height). */
  maxImagePixels: 40_000_000,
  /** sharp per-operation CPU deadline, in seconds. */
  imageTimeoutSeconds: 10,
  /** Deadline for one HEIC decode in its disposable worker, in ms. */
  heicTimeoutMs: 15_000,
  /** V8 resourceLimits for the HEIC worker (does not cap WASM/native memory). */
  heicWorkerOldGenerationMb: 128,
  heicWorkerYoungGenerationMb: 16,
  heicWorkerStackMb: 4,
  /** HEIC workers allowed at once per process. */
  maxHeicConcurrency: 1,
  /**
   * JPEG, PNG and WebP decodes allowed at once per process. Callers beyond it
   * wait (at most heicTimeoutMs) rather than adding to peak memory. Six is the
   * point past which more parallel decodes stopped adding throughput on an
   * 18-core laptop (sharp runs its own thread pool), so it is not a cap on a
   * 2 vCPU function; peak memory is about the same from 4 to 16 callers.
   */
  maxImageConcurrency: 6,
  /** Video probe: largest single range read, and total bytes read. */
  maxProbeReadBytes: 4 * MiB,
  maxProbeBytes: 16 * MiB,
  /** Video probe: range requests, top-level boxes and nesting depth. */
  maxProbeRequests: 96,
  maxVideoBoxes: 64,
  maxContainerDepth: 8,
  /** WebM probe: EBML elements visited. */
  maxEbmlElements: 20_000,
  /** Largest accepted video width or height. */
  maxVideoDimension: 32_768,
  /** Bytes read from the start of a file for type sniffing. */
  sniffHeadBytes: 64 * 1024,
  /** Longest edge of derivatives, in pixels. */
  previewPixels: 1600,
  thumbnailPixels: 480,
  avatarPixels: 256,
} as const

export type MediaLimits = typeof MEDIA_LIMITS

/** The abandoned window as a Postgres interval for `prepare_media_cleanup`. */
export function abandonedUploadInterval(
  limits: Pick<MediaLimits, "abandonedUploadWindowHours"> = MEDIA_LIMITS
): string {
  return `${limits.abandonedUploadWindowHours} hours`
}

/** The stale-processing window as a Postgres interval for `fail_stale_media_processing`. */
export function staleProcessingInterval(
  limits: Pick<MediaLimits, "staleProcessingMinutes"> = MEDIA_LIMITS
): string {
  return `${limits.staleProcessingMinutes} minutes`
}

export function maxBytesFor(
  kind: "image" | "video",
  limits: Pick<MediaLimits, "maxPhotoBytes" | "maxVideoBytes"> = MEDIA_LIMITS
): number {
  return kind === "image" ? limits.maxPhotoBytes : limits.maxVideoBytes
}
