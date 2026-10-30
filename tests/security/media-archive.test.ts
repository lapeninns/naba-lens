import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import type { Json } from "../../lib/db/types"
import { sha256, type ArchiveManifest } from "../../lib/server/archive/core"
import {
  anonClient,
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

const service = serviceClient()
let staff: TestIdentity
let admin: TestIdentity
let receipt: {
  asset_id: string
  sha256: string
  size_bytes: number
  mime_type: string
  source_project_ref: string
  source_key: string
  blob_key: string
  manifest_key: string
  manifest_sha256: string
  manifest: Json
}

beforeAll(async () => {
  const venue = await createVenue(service, "archive")
  staff = await createIdentity(service, {
    label: "archive-staff",
    role: "staff",
    venueId: venue.id,
  })
  admin = await createIdentity(service, {
    label: "archive-admin",
    role: "admin",
  })
  const reservation = await staff.client.rpc("reserve_media_asset", {
    p_client_upload_key: randomUUID(),
    p_extension: "jpg",
    p_media_type: "image",
    p_original_filename: "archive-fixture.jpg",
    p_size_bytes: 4,
  })
  if (reservation.error) throw reservation.error
  const asset = reservation.data[0]
  await markReady(service, asset.id)
  const project = "abcdefghijklmnopqrst"
  const hash = "a".repeat(64)
  const blobKey = `${project}/blobs/sha256/aa/${hash}`
  const manifest: ArchiveManifest = {
    format: "nabalens-original-archive@1",
    sourceProjectRef: project,
    sourceBucket: "media",
    assetId: asset.id,
    uploaderId: staff.id,
    venueId: venue.id,
    uploaderName: "Archive staff",
    venueName: venue.name,
    originalFilename: "archive-fixture.jpg",
    originalPath: asset.original_path,
    mediaType: "image",
    mimeType: "image/jpeg",
    sizeBytes: 4,
    uploadedAt: new Date().toISOString(),
    sha256: hash,
    blobKey,
  }
  const manifestHash = sha256(JSON.stringify(manifest))
  receipt = {
    asset_id: asset.id,
    sha256: hash,
    size_bytes: 4,
    mime_type: "image/jpeg",
    source_project_ref: project,
    source_key: asset.original_path,
    blob_key: blobKey,
    manifest_key: `${project}/manifests/${asset.id}/${hash}/${manifestHash}.json`,
    manifest_sha256: manifestHash,
    manifest: manifest as unknown as Json,
  }
})

describe("private append-only original archive receipts", () => {
  it("records a matching validated original and makes retries idempotent", async () => {
    const first = await service.from("media_archive_receipts").insert(receipt)
    expect(first.error).toBeNull()
    const retry = await service.from("media_archive_receipts").upsert(receipt, {
      onConflict: "asset_id,sha256,manifest_sha256",
      ignoreDuplicates: true,
    })
    expect(retry.error).toBeNull()
    const read = await service
      .from("media_archive_receipts")
      .select("id")
      .eq("asset_id", receipt.asset_id)
    expect(read.error).toBeNull()
    expect(read.data).toHaveLength(1)
  })

  it("rejects receipt metadata that does not match the asset or content-addressed keys", async () => {
    for (const patch of [
      { source_key: "another/original.jpg" },
      { size_bytes: 5 },
      { blob_key: "arbitrary-key" },
      { manifest: { ...(receipt.manifest as object), venueId: randomUUID() } },
    ]) {
      const result = await service
        .from("media_archive_receipts")
        .insert({ ...receipt, ...patch })
      expect(result.error?.code).toBe("22023")
    }
  })

  it("denies anonymous, staff and admin clients all archive metadata and audit RPCs", async () => {
    for (const client of [anonClient(), staff.client, admin.client]) {
      const read = await client.from("media_archive_receipts").select("*")
      expect(read.data ?? []).toHaveLength(0)
      expect(read.error?.code).toBe("42501")
      const write = await client.from("media_archive_receipts").insert(receipt)
      expect(write.error?.code).toBe("42501")
      const list = await client.rpc("media_archive_backfill_candidates", {
        p_limit: 10,
      })
      expect(list.error?.code).toBe("42501")
      const count = await client.rpc("media_archive_missing_count")
      expect(count.error?.code).toBe("42501")
      const state = await client.from("media_archive_audit_state").select("*")
      expect(state.data ?? []).toHaveLength(0)
      expect(state.error?.code).toBe("42501")
    }
    const readBack = await service
      .from("media_archive_receipts")
      .select("id")
      .eq("asset_id", receipt.asset_id)
    expect(readBack.data).toHaveLength(1)
  })

  it("does not let even the service client edit or delete retained attribution", async () => {
    const update = await service
      .from("media_archive_receipts")
      .update({ size_bytes: 5 } as never)
      .eq("asset_id", receipt.asset_id)
    expect(update.error).not.toBeNull()
    const remove = await service
      .from("media_archive_receipts")
      .delete()
      .eq("asset_id", receipt.asset_id)
    expect(remove.error?.code).toBe("42501")
    const read = await service
      .from("media_archive_receipts")
      .select("id")
      .eq("asset_id", receipt.asset_id)
    expect(read.data).toHaveLength(1)
  })
})
