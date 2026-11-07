import type { WorkFocus } from "@/lib/config/work-roles"
import type {
  LabelCatalogue,
  PendingLabelItem,
  SaveLabelsInput,
  UploadLabelPostResult,
} from "@/lib/menus/types"

export type UploadLabelContext =
  | { ok: true; catalogue: LabelCatalogue; focus: WorkFocus | null }
  | { ok: false; message: string }

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
 * offers "Retry labels".
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
  return response.json()
}

/** Discards what the server keeps for the asset (idempotent). */
export async function discardUploadLabels(assetId: string): Promise<boolean> {
  const response = await fetch(
    `/api/upload-labels?assetId=${encodeURIComponent(assetId)}`,
    { method: "DELETE" }
  )
  const result = (await response.json()) as { ok?: unknown }
  return result.ok === true
}

/** The person's kept labels (pending or needing attention); null on failure. */
export async function loadLabelAttention(): Promise<PendingLabelItem[] | null> {
  const response = await fetch("/api/upload-labels?attention=1", {
    cache: "no-store",
  })
  const result = (await response.json()) as
    { ok: true; items: PendingLabelItem[] } | { ok: false; message: string }
  return result.ok ? result.items : null
}
