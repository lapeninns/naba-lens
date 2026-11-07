// Public types for the browser upload transport. Client-only; no React and no
// server imports. See docs/upload-transport.md for the full contract.

import type { MediaLabelSummary, SaveLabelsErrorCode } from "../menus/types"

export type MediaKind = "image" | "video"

/**
 * Why a file is uploaded (matches `media_assets.purpose`). Amenity evidence is
 * never shown in the organisation community. Omitted means general.
 */
export type UploadPurpose = "general" | "amenity"

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
  /** Fixed by the first reservation for this key. Omitted: general. */
  purpose?: UploadPurpose
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

/**
 * What finalise did with labels the person chose while the file was still
 * uploading (stored on the server against the reserved asset). Present only
 * when such labels existed.
 */
export type FinaliseLabels =
  | { state: "saved"; labels: MediaLabelSummary }
  | { state: "needs_attention"; code: SaveLabelsErrorCode; message: string }

export type FinaliseResult =
  | { state: "ready"; labels?: FinaliseLabels }
  | { state: "failed"; error?: string }

export type ReserveFn = (input: ReserveInput) => Promise<ReserveResult>
export type FinaliseFn = (input: FinaliseInput) => Promise<FinaliseResult>

export type UploadErrorCode =
  | "empty_file"
  | "unsupported_type"
  | "too_large"
  | "aborted"
  | "reserve_failed"
  /**
   * The reservation for this key was removed, or reserved for another purpose;
   * a retry starts a new one.
   */
  | "reservation_gone"
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
  /** Called once the server has reserved the asset, before the transfer. */
  onReserved?: (reservation: { assetId: string; resumable: boolean }) => void
  signal?: AbortSignal
  /** Omitted: general. */
  purpose?: UploadPurpose
}

export type UploadResult = {
  /** `null` when the file was rejected before a reservation was made. */
  assetId: string | null
  state: "ready" | "failed"
  error?: UploadError
  /** From finalise, when labels were waiting for this asset. */
  labels?: FinaliseLabels
}

export type UploadFn = (
  file: File,
  options: UploadOptions
) => Promise<UploadResult>

// Copied verbatim from the ui track's components/nabalens/upload-queue.ts so
// lib/ never imports from components/. Keep the two in sync.

export type UploadContext = {
  signal: AbortSignal
  /** Report transfer progress as a fraction between 0 and 1. */
  onProgress: (fraction: number) => void
  /** Call once the bytes are stored and the server is validating them. */
  onProcessing: () => void
  /** Token stored by a previous attempt for this file, if any. */
  resumeToken: unknown
  setResumeToken: (token: unknown) => void
  attempt: number
  /**
   * Why the files are uploaded, fixed on the server at reservation. Amenity
   * evidence never appears in the organisation community. Omitted: general.
   */
  purpose?: UploadPurpose
  /** Called once the server has reserved the asset (its ID is known). */
  onReserved?: (assetId: string) => void
  /**
   * The signed-in account. Resume keys are kept per account, so another
   * account on the same device never reuses them. Omitted: not scoped.
   */
  account?: string
}

/** Injected upload function. Resolve when the asset is ready; reject on failure. */
export type Uploader = (
  file: File,
  context: UploadContext
) => Promise<void | { assetId: string; labels?: FinaliseLabels }>
