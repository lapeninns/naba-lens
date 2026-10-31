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

  describe("audit cycles and run history", () => {
    const run = (overrides: Record<string, unknown> = {}) => ({
      run_id: randomUUID(),
      started_at: "2026-10-30T12:00:00Z",
      finished_at: "2026-10-30T12:01:00Z",
      outcome: "partial",
      ...overrides,
    })

    it("keeps the run history service-only", async () => {
      const seeded = await service
        .from("media_archive_audit_runs")
        .insert(run({ outcome: "idle", bytes_verified: 1234 }))
        .select("id")
      expect(seeded.error).toBeNull()
      for (const client of [anonClient(), staff.client, admin.client]) {
        const read = await client.from("media_archive_audit_runs").select("*")
        expect(read.data ?? []).toHaveLength(0)
        expect(read.error?.code).toBe("42501")
        const write = await client
          .from("media_archive_audit_runs")
          .insert(run())
        expect(write.error?.code).toBe("42501")
        const remove = await client
          .from("media_archive_audit_runs")
          .delete()
          .gte("id", 0)
        expect(remove.error?.code).toBe("42501")
      }
    })

    it("is append-only apart from pruning rows past 90 days", async () => {
      const recent = run({
        finished_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
      })
      expect(
        (await service.from("media_archive_audit_runs").insert(recent)).error
      ).toBeNull()
      const update = await service
        .from("media_archive_audit_runs")
        .update({ outcome: "failed" } as never)
        .eq("run_id", recent.run_id)
      expect(update.error?.code).toBe("42501")
      const remove = await service
        .from("media_archive_audit_runs")
        .delete()
        .eq("run_id", recent.run_id)
      expect(remove.error?.code).toBe("42501")
      const kept = await service
        .from("media_archive_audit_runs")
        .select("outcome")
        .eq("run_id", recent.run_id)
      expect(kept.data).toEqual([{ outcome: "partial" }])

      const old = run({
        started_at: "2020-01-01T00:00:00Z",
        finished_at: "2020-01-01T00:01:00Z",
      })
      expect(
        (await service.from("media_archive_audit_runs").insert(old)).error
      ).toBeNull()
      const prune = await service
        .from("media_archive_audit_runs")
        .delete()
        .lt("finished_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
      expect(prune.error).toBeNull()
      const gone = await service
        .from("media_archive_audit_runs")
        .select("id")
        .eq("run_id", old.run_id)
      expect(gone.data).toEqual([])
    })

    it("rejects run rows whose outcome, error or run id are inconsistent", async () => {
      const failedWithoutCode = await service
        .from("media_archive_audit_runs")
        .insert(run({ outcome: "failed" }))
      expect(failedWithoutCode.error?.code).toBe("23514")
      const codeOnPartial = await service
        .from("media_archive_audit_runs")
        .insert(run({ error: "archive_audit_failed" }))
      expect(codeOnPartial.error?.code).toBe("23514")
      const unknownOutcome = await service
        .from("media_archive_audit_runs")
        .insert(run({ outcome: "ok" }))
      expect(unknownOutcome.error?.code).toBe("23514")
      const unknownError = await service
        .from("media_archive_audit_runs")
        .insert(
          run({ outcome: "failed", error: "disk exploded at /secret/path" })
        )
      expect(unknownError.error?.code).toBe("23514")
      const same = run()
      expect(
        (await service.from("media_archive_audit_runs").insert(same)).error
      ).toBeNull()
      const duplicate = await service
        .from("media_archive_audit_runs")
        .insert(same)
      expect(duplicate.error?.code).toBe("23505")
    })

    it("constrains the cycle columns and error codes on the audit state row", async () => {
      const update = (patch: Record<string, unknown>) =>
        service
          .from("media_archive_audit_state")
          .update(patch as never)
          .eq("name", "originals")
      try {
        const half = await update({ cycle_id: randomUUID() })
        expect(half.error?.code).toBe("23514")
        const orphanCursor = await update({ cursor_id: 5 })
        expect(orphanCursor.error?.code).toBe("23514")
        const badCode = await update({ last_error: "provider said no" })
        expect(badCode.error?.code).toBe("23514")
        const badOutcome = await update({ last_run_outcome: "great" })
        expect(badOutcome.error?.code).toBe("23514")
        const overshoot = await update({
          cycle_id: randomUUID(),
          cycle_started_at: "2026-10-30T12:00:00Z",
          cycle_target_id: 3,
          cycle_target_count: 3,
          cursor_id: 4,
        })
        expect(overshoot.error?.code).toBe("23514")
        const open = await update({
          cycle_id: randomUUID(),
          cycle_started_at: "2026-10-30T12:00:00Z",
          cycle_target_id: 3,
          cycle_target_count: 3,
          cursor_id: 2,
          cycle_checked: 2,
          last_run_outcome: "timeout",
          last_error: "archive_audit_timeout",
          consecutive_failures: 1,
        })
        expect(open.error).toBeNull()
      } finally {
        await update({
          cycle_id: null,
          cycle_started_at: null,
          cycle_target_id: null,
          cycle_target_count: null,
          cursor_id: 0,
          cycle_checked: 0,
          last_run_outcome: null,
          last_error: null,
          consecutive_failures: 0,
        })
      }
    })
  })
})
