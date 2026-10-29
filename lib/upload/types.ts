// Public types for the browser upload transport. Client-only; no React and no
// server imports. See docs/upload-transport.md for the full contract.

export type MediaKind = "image" | "video"

/** Server-side states an asset moves through (matches the `upload_state` enum). */
export type UploadState = "uploading" | "processing" | "ready" | "failed"

/**
 * Subset of `lib/config/media.ts` the client needs for early checks.
 * `MEDIA_LIMITS` is structurally assignable to this type; pass it in.
 */
export type ClientUploadLimits = {
  maxPhotoBytes: number
  maxVideoBytes: number
  /** Defaults to JPEG, PNG, WebP, HEIC, HEIF. */
  acceptedImageTypes?: readonly string[]
  /** Defaults to MP4, MOV (QuickTime), WebM. */
  acceptedVideoTypes?: readonly string[]
}

/** What the browser tells the server when it asks for a reservation. */
export type ReserveInput = {
  /** Stable per file across retries; the server must return the same asset for it. */
  idempotencyKey: string
  filename: string
  sizeBytes: number
  /** Browser-reported MIME type (may be empty). A hint only; never trusted. */
  contentType: string
  /** Client guess from MIME/extension. A hint only; never trusted. */
  mediaType: MediaKind
  /** True when the client would prefer a TUS resumable transfer. */
  preferResumable: boolean
}

export type ReserveResult = {
  assetId: string
  /** Object key inside the bucket, e.g. `{uploader_id}/{asset_id}/original.jpg`. */
  objectKey: string
  bucket: "media"
  /** Signed upload URL (from `createSignedUploadUrl`) for the non-resumable path. */
  uploadUrl?: string
  /** Signed upload token, if the server returned one. Informational. */
  token?: string
  /** Use TUS when true; otherwise PUT to `uploadUrl`. */
  resumable: boolean
  /**
   * Current server state of an existing reservation for this idempotency key.
   * `processing`: the bytes are already stored, skip the transfer and finalise.
   * `ready`: nothing to do. Omitted or `uploading`: transfer as normal.
   */
  state?: UploadState
}

export type FinaliseInput = { assetId: string; idempotencyKey: string }

export type FinaliseResult =
  { state: "ready" } | { state: "failed"; error?: string }

export type ReserveFn = (input: ReserveInput) => Promise<ReserveResult>
export type FinaliseFn = (input: FinaliseInput) => Promise<FinaliseResult>

export type UploadErrorCode =
  | "empty_file"
  | "unsupported_type"
  | "too_large"
  | "aborted"
  | "reserve_failed"
  | "transfer_failed"
  | "finalise_failed"
  | "processing_failed"

export type UploadError = {
  code: UploadErrorCode
  /** Plain-language message suitable for the upload dialog. */
  message: string
  /** True when retrying the same file with the same idempotency key may help. */
  retryable: boolean
}

export type UploadOptions = {
  /** Generate once per file (e.g. `crypto.randomUUID()`) and reuse on every retry. */
  idempotencyKey: string
  /** Fraction 0..1 of bytes stored. */
  onProgress?: (fraction: number) => void
  onStateChange?: (state: UploadState) => void
  signal?: AbortSignal
}

export type UploadResult = {
  /** `null` when the file was rejected before a reservation was made. */
  assetId: string | null
  state: "ready" | "failed"
  error?: UploadError
}

export type UploadFn = (
  file: File,
  options: UploadOptions
) => Promise<UploadResult>
