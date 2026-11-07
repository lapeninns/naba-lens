import {
  EMPTY_LABEL_SUMMARY,
  type MediaLabelSummary,
  type SaveLabelsErrorCode,
  type SaveLabelsInput,
  type SaveLabelsResult,
} from "@/lib/menus/types"

// Me's "Needs attention": labels kept on the server for the caller's own
// uploads (GET /api/upload-labels?attention=1), fixed by saving a corrected
// input (POST, the photo is ready so it saves now) or discarded (DELETE).

/**
 * One stored label input for an own upload.
 * TODO(integration): import PendingLabelItem from "@/lib/menus/types" (S1).
 */
export type PendingLabelItem = {
  assetId: string
  venueId: string
  status: "pending" | "needs_attention"
  code: SaveLabelsErrorCode | null
  message: string | null
  input: SaveLabelsInput
  uploadState: string
  mediaType: "image" | "video"
  thumbnailUrl: string | null
  updatedAt: string
}

/**
 * POST /api/upload-labels.
 * TODO(integration): import UploadLabelPostResult from "@/lib/menus/types" (S1).
 */
type UploadLabelPostResult =
  | { ok: true; assetId: string; state: "saved"; labels: MediaLabelSummary }
  | { ok: true; assetId: string; state: "pending" }
  | { ok: false; assetId: string; code: SaveLabelsErrorCode; message: string }

export type AttentionResult =
  { ok: true; items: PendingLabelItem[] } | { ok: false; message: string }

export const ATTENTION_LOAD_FAILED =
  "We couldn't check for photos that need attention. Check your connection and try again."
const SAVE_FAILED = "Labels not saved yet. Check your connection and try again."

export async function loadNeedsAttention(
  signal?: AbortSignal
): Promise<AttentionResult> {
  try {
    const response = await fetch("/api/upload-labels?attention=1", {
      signal,
      cache: "no-store",
    })
    const result = (await response.json()) as AttentionResult
    if (!result.ok) return { ok: false, message: result.message }
    // A server without the list answers with the label catalogue instead:
    // nothing is stored there, so nothing needs attention.
    return { ok: true, items: Array.isArray(result.items) ? result.items : [] }
  } catch (error) {
    if (signal?.aborted) throw error
    return { ok: false, message: ATTENTION_LOAD_FAILED }
  }
}

/** Discard the stored labels of one own upload (idempotent). */
export async function discardPendingLabels(assetId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/upload-labels?assetId=${encodeURIComponent(assetId)}`,
      { method: "DELETE" }
    )
    const result = (await response.json()) as { ok: boolean }
    return result.ok === true
  } catch {
    return false
  }
}

/**
 * "Fix labels": save the corrected input. The photo is ready, so the server
 * saves it now and drops the stored row. "pending" (the photo is somehow
 * still processing) keeps the input on the server; it counts as stored.
 */
export async function saveFixedLabels(
  venueId: string,
  input: SaveLabelsInput
): Promise<SaveLabelsResult & { pending?: boolean }> {
  let result: UploadLabelPostResult
  try {
    const response = await fetch("/api/upload-labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venueId, input }),
    })
    result = (await response.json()) as UploadLabelPostResult
  } catch {
    return {
      ok: false,
      assetId: input.assetId,
      code: "unavailable",
      message: SAVE_FAILED,
    }
  }
  if (!result.ok) return result
  return result.state === "saved"
    ? { ok: true, assetId: result.assetId, labels: result.labels }
    : {
        ok: true,
        assetId: result.assetId,
        labels: EMPTY_LABEL_SUMMARY,
        pending: true,
      }
}
