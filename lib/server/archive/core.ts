import { createHash } from "node:crypto"

export type ArchiveSource = {
  assetId: string
  uploaderId: string
  venueId: string
  uploaderName: string
  venueName: string
  originalFilename: string
  originalPath: string
  mediaType: "image" | "video"
  mimeType: string
  sizeBytes: number
  uploadedAt: string
}

export type ArchiveManifest = ArchiveSource & {
  format: "nabalens-original-archive@1"
  sourceProjectRef: string
  sourceBucket: "media"
  sha256: string
  blobKey: string
}

export type RetainedOriginalReceipt = {
  asset_id: string
  sha256: string
  size_bytes: number
  mime_type: string
  source_project_ref: string
  source_key: string
  blob_key: string
  manifest_key: string
  manifest_sha256: string
  manifest: ArchiveManifest
}

export type PreparedOriginal = {
  sha256: string
  sizeBytes: number
  /** Stream/file adapter, deliberately opaque to the orchestration. */
  handle: unknown
  dispose(): Promise<void>
}

export type ArchiveStore = {
  /** Conditional create only; an existing object must be verified, never overwritten. */
  putOriginalIfAbsent(
    key: string,
    original: PreparedOriginal,
    mime: string
  ): Promise<void>
  verifyOriginal(key: string, sha256: string, size: number): Promise<void>
  putManifestIfAbsent(key: string, body: Uint8Array): Promise<void>
  verifyManifest(key: string, sha256: string, size: number): Promise<void>
  close?(): void
}

export type ArchiveDeps = {
  projectRef: string
  prepare(source: ArchiveSource): Promise<PreparedOriginal>
  store: ArchiveStore
  record(receipt: RetainedOriginalReceipt): Promise<void>
}

export const sha256 = (body: Uint8Array | string) =>
  createHash("sha256").update(body).digest("hex")

/** A receipt is committed only after both bytes and attribution have been read back. */
export async function archiveOriginal(
  source: ArchiveSource,
  deps: ArchiveDeps
): Promise<RetainedOriginalReceipt> {
  if (
    !Number.isSafeInteger(source.sizeBytes) ||
    source.sizeBytes <= 0 ||
    source.sizeBytes > 200 * 1024 * 1024
  )
    throw new Error("archive_invalid_size")
  const original = await deps.prepare(source)
  try {
    if (
      original.sizeBytes !== source.sizeBytes ||
      !/^[a-f0-9]{64}$/.test(original.sha256)
    ) {
      throw new Error("archive_source_mismatch")
    }
    const blobKey = `${deps.projectRef}/blobs/sha256/${original.sha256.slice(0, 2)}/${original.sha256}`
    await deps.store.putOriginalIfAbsent(blobKey, original, source.mimeType)
    await deps.store.verifyOriginal(
      blobKey,
      original.sha256,
      original.sizeBytes
    )
    const manifest: ArchiveManifest = {
      format: "nabalens-original-archive@1",
      sourceProjectRef: deps.projectRef,
      sourceBucket: "media",
      ...source,
      sha256: original.sha256,
      blobKey,
    }
    const body = new TextEncoder().encode(JSON.stringify(manifest))
    const manifestSha = sha256(body)
    const manifestKey = `${deps.projectRef}/manifests/${source.assetId}/${original.sha256}/${manifestSha}.json`
    await deps.store.putManifestIfAbsent(manifestKey, body)
    await deps.store.verifyManifest(manifestKey, manifestSha, body.byteLength)
    const receipt: RetainedOriginalReceipt = {
      asset_id: source.assetId,
      sha256: original.sha256,
      size_bytes: original.sizeBytes,
      mime_type: source.mimeType,
      source_project_ref: deps.projectRef,
      source_key: source.originalPath,
      blob_key: blobKey,
      manifest_key: manifestKey,
      manifest_sha256: manifestSha,
      manifest,
    }
    await deps.record(receipt)
    return receipt
  } finally {
    await original.dispose()
  }
}
