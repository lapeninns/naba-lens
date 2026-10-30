import "server-only"

// CONTRACT STUB (owner F, docs/fanout/CONTRACT-v0.3-menus.md). Replace the
// bodies; keep these signatures. Writes go only through the
// save_media_labels RPC as the caller (actor.db), never the service role.

import type {
  LabelCatalogue,
  LabelEditorAsset,
  MediaLabelSummary,
  SaveLabelsInput,
  SaveLabelsResult,
} from "@/lib/menus/types"
import type { Db, MediaActor, Outcome } from "@/lib/server/media/types"

/**
 * The active catalogue of `venueId` for labelling. Staff: only venues they may
 * label (current venue or a venue of one of their own assets); admin: any.
 */
export async function getLabellingCatalogue(
  actor: MediaActor,
  venueId: string
): Promise<Outcome<{ catalogue: LabelCatalogue }>> {
  void actor
  void venueId
  return { ok: false, status: 503, message: "Labels are not available yet." }
}

/**
 * The editor's view of up to LABEL_LIMITS.maxBatchAssets assets the caller may
 * label (own ready assets for staff; ready assets for admin) with their
 * current labels. Unknown/forbidden ids are omitted and listed in `missing`.
 */
export async function getAssetLabelContext(
  actor: MediaActor,
  assetIds: string[]
): Promise<Outcome<{ assets: LabelEditorAsset[]; missing: string[] }>> {
  void actor
  void assetIds
  return { ok: false, status: 503, message: "Labels are not available yet." }
}

export async function saveAssetLabels(
  actor: MediaActor,
  input: SaveLabelsInput
): Promise<SaveLabelsResult> {
  void actor
  return {
    ok: false,
    assetId: input.assetId,
    code: "unavailable",
    message: "Labels are not available yet.",
  }
}

/**
 * Label summaries for a page of gallery assets, read as the caller (RLS), in
 * at most a few queries (no N+1). Assets without labels are absent.
 */
export async function loadLabelSummaries(
  db: Db,
  assetIds: string[]
): Promise<Map<string, MediaLabelSummary>> {
  void db
  void assetIds
  return new Map()
}
