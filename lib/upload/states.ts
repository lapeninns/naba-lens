// The upload's states, kept apart as the Full App spec asks (§10: "do not
// implement one overloaded status column"), and the honest receipt a person
// sees for each photo (§5.6). Pure functions over what the queue and the
// server already know; no React, no server imports.
//
//   Transfer    Local draft, Queued, Uploading, Uploaded, Retry needed,
//               Cancelled. From the queue item (components/nabalens/
//               upload-queue.ts) on this device.
//   Processing  Waiting, Processing, Ready, Failed. From the server's
//               media_assets.upload_state (and, on the device, from the
//               queue item once its bytes have arrived).
//   Receipt     What the person is told (§5.6), in Album's words (DESIGN.md
//               §4, §6.8, §7):
//                 saved_on_device      "Saved on this phone": picked, not yet
//                                      sent (offline, or waiting its turn
//                                      while offline).
//                 uploading            "Sending": the bytes are on their way.
//                 uploaded_processing  "Checking": the server has the
//                                      original and is still processing it.
//                 sent_for_review      "Waiting": processed AND the photo's
//                                      slot was saved with it, so a review
//                                      entry exists.
//                 ready                "Sent": processed; no slot was saved
//                                      with it by finalise (none chosen, or
//                                      saved separately afterwards).
//                 label_not_saved      "Sent": processed, but the slot chosen
//                                      for it could not be saved with it, so
//                                      there is no review entry until the
//                                      person fixes it (Me).
//                 processing_failed    "Couldn't finish": the server had the
//                                      file and could not finish it. Try
//                                      again asks the server again; the
//                                      bytes are not sent twice unless the
//                                      server had to remove them.
//                 not_sent             "Not sent": the transfer stopped.
//                                      Try again resumes it.
//                 cancelled            "Not sent": the person cancelled it.
//
// "Waiting" is never shown for a photo whose slot is known not to have been
// saved: it reads "Sent" and its slot problem is shown where the person
// fixes it.

import type { FinaliseLabels, UploadState } from "./types"

export type TransferState =
  | "local_draft"
  | "queued"
  | "uploading"
  | "uploaded"
  | "retry_needed"
  | "cancelled"

export type ProcessingState = "waiting" | "processing" | "ready" | "failed"

export type UploadReceipt =
  | "saved_on_device"
  | "uploading"
  | "uploaded_processing"
  | "sent_for_review"
  | "ready"
  | "label_not_saved"
  | "processing_failed"
  | "not_sent"
  | "cancelled"

/** What the mapping reads from a queue item (structurally a QueueItem). */
export type QueueItemLike = {
  status:
    | "selected"
    | "queued"
    | "uploading"
    | "processing"
    | "done"
    | "failed"
    | "cancelled"
  failedStage?: "transfer" | "processing"
  labels?: FinaliseLabels
}

/** The transfer dimension of a queue item (spec §10). */
export function transferState(item: QueueItemLike): TransferState {
  switch (item.status) {
    case "selected":
      return "local_draft"
    case "queued":
      return "queued"
    case "uploading":
      return "uploading"
    case "processing":
    case "done":
      return "uploaded"
    case "cancelled":
      return "cancelled"
    case "failed":
      return item.failedStage === "processing" ? "uploaded" : "retry_needed"
  }
}

/**
 * The processing dimension of a queue item: null until the bytes have
 * arrived (there is nothing on the server to process yet).
 */
export function processingState(item: QueueItemLike): ProcessingState | null {
  switch (item.status) {
    case "processing":
      return "processing"
    case "done":
      return "ready"
    case "failed":
      return item.failedStage === "processing" ? "failed" : null
    default:
      return null
  }
}

/**
 * The processing dimension from the server's upload_state (spec §10).
 * `uploading` with the original stored is Waiting (accepted, not yet
 * claimed); without it there is nothing to process yet (null).
 */
export function serverProcessingState(
  uploadState: UploadState,
  originalStored: boolean
): ProcessingState | null {
  switch (uploadState) {
    case "uploading":
      return originalStored ? "waiting" : null
    case "processing":
      return "processing"
    case "ready":
      return "ready"
    case "failed":
      return originalStored ? "failed" : null
  }
}

/**
 * The honest receipt for a queue item (spec §5.6). `online` false: files
 * waiting to send are only saved on this device.
 */
export function uploadReceipt(
  item: QueueItemLike,
  { online = true }: { online?: boolean } = {}
): UploadReceipt {
  switch (item.status) {
    case "selected":
      return "saved_on_device"
    case "queued":
      return online ? "uploading" : "saved_on_device"
    case "uploading":
      return "uploading"
    case "processing":
      return "uploaded_processing"
    case "done":
      return item.labels?.state === "saved"
        ? "sent_for_review"
        : item.labels?.state === "needs_attention"
          ? "label_not_saved"
          : "ready"
    case "failed":
      return item.failedStage === "processing"
        ? "processing_failed"
        : "not_sent"
    case "cancelled":
      return "cancelled"
  }
}

/** Album's word for each receipt (DESIGN.md §4, §7; departures.md). */
export const RECEIPT_WORDS: Record<UploadReceipt, string> = {
  saved_on_device: "Saved on this phone",
  uploading: "Sending",
  uploaded_processing: "Checking",
  sent_for_review: "Waiting",
  ready: "Sent",
  label_not_saved: "Sent",
  processing_failed: "Couldn't finish",
  not_sent: "Not sent",
  cancelled: "Not sent",
}

/** The spec's own name for each receipt (§5.6), for managers and docs. */
export const RECEIPT_SPEC_NAMES: Record<UploadReceipt, string> = {
  saved_on_device: "Saved on this device",
  uploading: "Uploading",
  uploaded_processing: "Uploaded — processing",
  sent_for_review: "Sent for review",
  ready: "Uploaded",
  label_not_saved: "Uploaded — needs label",
  processing_failed: "Processing failed",
  not_sent: "Retry needed",
  cancelled: "Cancelled",
}
