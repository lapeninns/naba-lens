import type { WorkFocus } from "@/lib/config/work-roles"
import type {
  LabelCatalogue,
  SaveLabelsInput,
  SaveLabelsResult,
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

export async function saveUploadLabelDraft(
  venueId: string,
  input: SaveLabelsInput
): Promise<SaveLabelsResult> {
  const response = await fetch("/api/upload-labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ venueId, input }),
  })
  return response.json()
}
