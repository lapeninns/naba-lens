import { loadLabelEditorContext } from "@/app/_labels/actions"
import { SessionExpiredError } from "@/components/nabalens/upload-queue"
import type { WorkFocus } from "@/lib/config/work-roles"
import type {
  LabelCatalogue,
  MediaLabelSummary,
  PendingLabelItem,
  SaveLabelsInput,
  UploadLabelDiscardResult,
  UploadLabelPostResult,
} from "@/lib/menus/types"

export type UploadLabelContext =
  | { ok: true; catalogue: LabelCatalogue; focus: WorkFocus | null }
  | { ok: false; message: string }

/** A 401 means the session ended: the sheet asks the person to sign in. */
function signedIn(response: Response) {
  if (response.status === 401) throw new SessionExpiredError()
  return response
}

export async function loadUploadLabelContext(
  signal: AbortSignal
): Promise<UploadLabelContext> {
  const response = await fetch("/api/upload-labels", {
    signal,
    cache: "no-store",
  })
  return response.json()
}

/**
 * Sends the labels for one reserved asset (C1): saved now when the asset is
 * ready, else kept on the server until finalise. Rejects when there is no
 * answer to read (no signal, or a sign-in page instead of JSON), so the sheet
 * offers "Retry labels", and with SessionExpiredError when signed out.
 */
export async function saveUploadLabels(
  venueId: string,
  input: SaveLabelsInput
): Promise<UploadLabelPostResult> {
  const response = await fetch("/api/upload-labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ venueId, input }),
  })
  return signedIn(response).json()
}

/**
 * Discards what the server keeps for the asset (C6): "already_applied" when
 * finalise put them on the photo first. Null when it failed.
 */
export async function discardUploadLabels(
  assetId: string
): Promise<UploadLabelDiscardResult | null> {
  const response = await fetch(
    `/api/upload-labels?assetId=${encodeURIComponent(assetId)}`,
    { method: "DELETE" }
  )
  const result = (await signedIn(response).json()) as {
    ok?: unknown
    state?: unknown
    labels?: MediaLabelSummary
  }
  if (result.ok !== true) return null
  if (result.state === "already_applied")
    // Without the labels the sheet cannot show or clear them: not an answer.
    return result.labels
      ? { ok: true, state: "already_applied", labels: result.labels }
      : null
  if (result.state === "none") return { ok: true, state: "none" }
  // "discarded", and a server from before the state was reported (it only
  // answered ok once the labels were gone).
  return { ok: true, state: "discarded" }
}

/** The person's kept labels (pending or needing attention); null on failure. */
export async function loadLabelAttention(): Promise<PendingLabelItem[] | null> {
  const response = await fetch("/api/upload-labels?attention=1", {
    cache: "no-store",
  })
  const result = (await signedIn(response).json()) as
    { ok: true; items: PendingLabelItem[] } | { ok: false; message: string }
  return result.ok && Array.isArray(result.items) ? result.items : null
}

/**
 * The labels on one of the person's ready photos, as they are now; null when
 * it cannot be read (not ready, removed, or no answer).
 */
export async function loadPhotoLabels(
  assetId: string
): Promise<MediaLabelSummary | null> {
  const result = await loadLabelEditorContext([assetId])
  if (!result?.ok) {
    if (result?.status === 401) throw new SessionExpiredError()
    return null
  }
  return result.assets.find((asset) => asset.id === assetId)?.labels ?? null
}
