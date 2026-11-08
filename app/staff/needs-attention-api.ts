import {
  EMPTY_LABEL_SUMMARY,
  type MediaLabelSummary,
  type PendingLabelItem,
  type SaveLabelsInput,
  type SaveLabelsResult,
  type UploadLabelPostResult,
} from "@/lib/menus/types"

// Me's "Needs attention": labels kept on the server for the caller's own
// uploads (GET /api/upload-labels?attention=1), fixed by saving a corrected
// input (POST, the photo is ready so it saves now) or discarded (DELETE).

export type AttentionResult =
  { ok: true; items: PendingLabelItem[] } | { ok: false; message: string }

/**
 * What a discard did (C6). "already_applied": the photo's upload applied the
 * labels first, so nothing was discarded and the photo has these labels
 * (null when the server didn't say which). "none": nothing was kept.
 */
export type DiscardResult =
  | { ok: true; state: "discarded" | "none" }
  | { ok: true; state: "already_applied"; labels: MediaLabelSummary | null }
  | { ok: false; message?: string }

export const ATTENTION_LOAD_FAILED =
  "We couldn't check for photos that need attention. Check your connection and try again."
/** The request failed in flight: the server may have saved the labels. */
export const SAVE_UNCONFIRMED =
  "We couldn't confirm the labels were saved. Check your connection and try again."
/** A 401: the session ended. Me's buttons say "Try again", not "Retry". */
export const SIGNED_OUT_MESSAGE = "Sign in again, then try again."

export async function loadNeedsAttention(
  signal?: AbortSignal
): Promise<AttentionResult> {
  try {
    const response = await fetch("/api/upload-labels?attention=1", {
      signal,
      cache: "no-store",
    })
    if (response.status === 401)
      return { ok: false, message: SIGNED_OUT_MESSAGE }
    const result = (await response.json()) as AttentionResult
    if (!result.ok) return { ok: false, message: result.message }
    // A reply without the list is not "nothing needs attention": saying so
    // could hide labels that are waiting for the person.
    if (!Array.isArray(result.items))
      return { ok: false, message: ATTENTION_LOAD_FAILED }
    return { ok: true, items: result.items }
  } catch (error) {
    if (signal?.aborted) throw error
    return { ok: false, message: ATTENTION_LOAD_FAILED }
  }
}

/** Discard the stored labels of one own upload (idempotent). */
export async function discardPendingLabels(
  assetId: string
): Promise<DiscardResult> {
  try {
    const response = await fetch(
      `/api/upload-labels?assetId=${encodeURIComponent(assetId)}`,
      { method: "DELETE" }
    )
    if (response.status === 401)
      return { ok: false, message: SIGNED_OUT_MESSAGE }
    const result = (await response.json()) as {
      ok?: boolean
      state?: string
      labels?: MediaLabelSummary
    }
    if (result.ok !== true) return { ok: false }
    if (result.state === "already_applied")
      return {
        ok: true,
        state: "already_applied",
        labels:
          result.labels && typeof result.labels === "object"
            ? result.labels
            : null,
      }
    if (result.state === "none") return { ok: true, state: "none" }
    // "discarded", and a server from before the state was reported (it only
    // answered ok once the labels were gone).
    return { ok: true, state: "discarded" }
  } catch {
    return { ok: false }
  }
}

/** The photo's labels are exactly what `input` would save. */
export function sameLabels(
  labels: MediaLabelSummary,
  input: SaveLabelsInput
): boolean {
  const key = (ref: { itemId: string; variantId: string | null }) =>
    `${ref.itemId}:${ref.variantId ?? ""}`
  const saved = new Set(labels.items.map(key))
  const wanted = new Set(input.items.map(key))
  const types = new Set(labels.contentTypes)
  return (
    saved.size === wanted.size &&
    [...wanted].every((k) => saved.has(k)) &&
    types.size === new Set(input.contentTypes).size &&
    input.contentTypes.every((t) => types.has(t)) &&
    (labels.note ?? "").trim() === (input.note ?? "").trim() &&
    (input.missingItem == null ||
      input.missingItem.trim() === (labels.missingItem ?? "").trim())
  )
}

/**
 * "Fix labels": save the corrected input. A ready photo saves it now and * drops the stored row. "pending" (the photo hasn't finished saving) keeps
 * the input on the server; it counts as stored, not as on the photo.
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
    if (response.status === 401)
      return {
        ok: false,
        assetId: input.assetId,
        code: "forbidden",
        message: SIGNED_OUT_MESSAGE,
      }
    result = (await response.json()) as UploadLabelPostResult
  } catch {
    return {
      ok: false,
      assetId: input.assetId,
      code: "unavailable",
      message: SAVE_UNCONFIRMED,
    }
  }
  // A retry after an unconfirmed save meets the save it is repeating: the
  // photo moved on to exactly these labels, so they are saved, not changed
  // somewhere else.
  if (
    !result.ok &&
    result.code === "conflict" &&
    result.current &&
    sameLabels(result.current, input)
  )
    return { ok: true, assetId: input.assetId, labels: result.current }
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
