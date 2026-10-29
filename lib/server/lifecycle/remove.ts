import "server-only"

// PLACEHOLDER owned by the lifecycle track (docs/fanout/CONTRACT.md).
// INTEGRATOR: when merging feat/nl-lifecycle, take lifecycle's version of this
// file. This stub exists only so the slice branch typechecks and builds; it
// mirrors the agreed signature and deletes nothing.

export type RemoveMediaAssetResult =
  | { ok: true; assetId: string; storage: "removed" | "pending" }
  | {
      ok: false
      status: 401 | 403 | 404 | 500
      error:
        | "unauthenticated"
        | "inactive"
        | "forbidden"
        | "not_found"
        | "failed"
    }

export async function removeMediaAsset(
  assetId: string
): Promise<RemoveMediaAssetResult> {
  void assetId
  return { ok: false, status: 500, error: "failed" }
}
