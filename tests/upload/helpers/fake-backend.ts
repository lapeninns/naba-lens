// Fake reserve/finalise server actions with the idempotency rules the slice
// track must implement: one asset per idempotency key, finalise idempotent.

import type {
  FinaliseInput,
  FinaliseResult,
  ReserveInput,
  ReserveResult,
  UploadState,
} from "../../../lib/upload"
import type { FakeStorage } from "./fake-storage"

type Asset = {
  assetId: string
  objectKey: string
  sizeBytes: number
  resumable: boolean
  state: UploadState
}

export function createFakeBackend(storage: FakeStorage) {
  const assets = new Map<string, Asset>()
  const byIdempotencyKey = new Map<string, string>()
  const calls = {
    reserve: [] as ReserveInput[],
    finalise: [] as FinaliseInput[],
  }
  let nextId = 0

  async function reserve(input: ReserveInput): Promise<ReserveResult> {
    calls.reserve.push(input)
    let assetId = byIdempotencyKey.get(input.idempotencyKey)
    if (!assetId) {
      assetId = `asset-${++nextId}`
      const ext = input.mediaType === "video" ? "mp4" : "jpg"
      assets.set(assetId, {
        assetId,
        objectKey: `uploader-1/${assetId}/original.${ext}`,
        sizeBytes: input.sizeBytes,
        resumable: input.preferResumable,
        state: "uploading",
      })
      byIdempotencyKey.set(input.idempotencyKey, assetId)
    }
    const asset = assets.get(assetId)!
    return {
      assetId,
      objectKey: asset.objectKey,
      bucket: "media",
      resumable: asset.resumable,
      uploadUrl: asset.resumable
        ? undefined
        : `${storage.url}/storage/v1/object/upload/sign/media/${asset.objectKey}?token=signed`,
      token: asset.resumable ? undefined : "signed",
      state: asset.state,
    }
  }

  async function finalise(input: FinaliseInput): Promise<FinaliseResult> {
    calls.finalise.push(input)
    const asset = assets.get(input.assetId)
    if (!asset) return { state: "failed", error: "Unknown asset" }
    if (asset.state === "ready") return { state: "ready" }
    const bytes = storage.objects.get(`media/${asset.objectKey}`)
    if (!bytes || bytes.length !== asset.sizeBytes) {
      asset.state = "failed"
      return { state: "failed", error: "Stored file is incomplete" }
    }
    asset.state = "ready"
    return { state: "ready" }
  }

  return { reserve, finalise, calls, assets }
}
