// The upload's separate state dimensions and honest receipts
// (lib/upload/states.ts; Full App spec §5.6, §10).
import { describe, expect, it } from "vitest"

import {
  processingState,
  RECEIPT_SPEC_NAMES,
  RECEIPT_WORDS,
  serverProcessingState,
  transferState,
  uploadReceipt,
  type QueueItemLike,
} from "../../lib/upload/states"

const saved = {
  state: "saved",
  labels: {} as never,
} as const
const attention = {
  state: "needs_attention",
  code: "conflict",
  message: "x",
} as const

const item = (patch: Partial<QueueItemLike>): QueueItemLike => ({
  status: "selected",
  ...patch,
})

describe("transferState", () => {
  it("names every queue status in the spec's transfer words", () => {
    expect(transferState(item({ status: "selected" }))).toBe("local_draft")
    expect(transferState(item({ status: "queued" }))).toBe("queued")
    expect(transferState(item({ status: "uploading" }))).toBe("uploading")
    expect(transferState(item({ status: "processing" }))).toBe("uploaded")
    expect(transferState(item({ status: "done" }))).toBe("uploaded")
    expect(transferState(item({ status: "cancelled" }))).toBe("cancelled")
    expect(transferState(item({ status: "failed" }))).toBe("retry_needed")
    expect(
      transferState(item({ status: "failed", failedStage: "transfer" }))
    ).toBe("retry_needed")
    // The bytes arrived: the transfer is done even though processing failed.
    expect(
      transferState(item({ status: "failed", failedStage: "processing" }))
    ).toBe("uploaded")
  })
})

describe("processingState", () => {
  it("has no processing state before the bytes arrive", () => {
    for (const status of [
      "selected",
      "queued",
      "uploading",
      "cancelled",
    ] as const)
      expect(processingState(item({ status }))).toBeNull()
    expect(processingState(item({ status: "failed" }))).toBeNull()
  })
  it("follows the server once the bytes arrived", () => {
    expect(processingState(item({ status: "processing" }))).toBe("processing")
    expect(processingState(item({ status: "done" }))).toBe("ready")
    expect(
      processingState(item({ status: "failed", failedStage: "processing" }))
    ).toBe("failed")
  })
  it("maps the server's upload_state", () => {
    expect(serverProcessingState("uploading", false)).toBeNull()
    expect(serverProcessingState("uploading", true)).toBe("waiting")
    expect(serverProcessingState("processing", true)).toBe("processing")
    expect(serverProcessingState("ready", true)).toBe("ready")
    expect(serverProcessingState("failed", true)).toBe("failed")
    // Failed with its bytes removed (invalid file): nothing to process.
    expect(serverProcessingState("failed", false)).toBeNull()
  })
})

describe("uploadReceipt", () => {
  it("never says sent while the file is only on the phone", () => {
    expect(uploadReceipt(item({ status: "selected" }))).toBe("saved_on_device")
    expect(uploadReceipt(item({ status: "queued" }), { online: false })).toBe(
      "saved_on_device"
    )
    expect(uploadReceipt(item({ status: "queued" }))).toBe("uploading")
    expect(uploadReceipt(item({ status: "uploading" }))).toBe("uploading")
  })

  it("says Uploaded — processing until the server has finished", () => {
    expect(uploadReceipt(item({ status: "processing" }))).toBe(
      "uploaded_processing"
    )
  })

  it("says Sent for review only when a review entry exists", () => {
    expect(uploadReceipt(item({ status: "done", labels: saved }))).toBe(
      "sent_for_review"
    )
    expect(uploadReceipt(item({ status: "done", labels: attention }))).toBe(
      "label_not_saved"
    )
    expect(uploadReceipt(item({ status: "done" }))).toBe("ready")
  })

  it("separates processing failed from a stopped transfer", () => {
    expect(
      uploadReceipt(item({ status: "failed", failedStage: "processing" }))
    ).toBe("processing_failed")
    expect(
      uploadReceipt(item({ status: "failed", failedStage: "transfer" }))
    ).toBe("not_sent")
    expect(uploadReceipt(item({ status: "cancelled" }))).toBe("cancelled")
  })

  it("has Album words and spec names for every receipt", () => {
    expect(Object.keys(RECEIPT_WORDS).sort()).toEqual(
      Object.keys(RECEIPT_SPEC_NAMES).sort()
    )
    expect(RECEIPT_WORDS.sent_for_review).toBe("Waiting")
    expect(RECEIPT_WORDS.uploaded_processing).toBe("Checking")
    expect(RECEIPT_WORDS.saved_on_device).toBe("Saved on this phone")
    expect(RECEIPT_SPEC_NAMES.uploaded_processing).toBe("Uploaded — processing")
  })
})
