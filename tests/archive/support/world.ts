import { randomUUID } from "node:crypto"

import { preparedOriginal, FakeBucket } from "./fake-bucket"
import { FakeDb, type Row } from "./fake-db"
import { TestClock } from "./clock"
import { sha256 } from "../../../lib/server/archive/core"

export const PROJECT_REF = "abcdefghijklmnopqrst"

export const FRESH_STATE: Row = {
  name: "originals",
  cursor_id: 0,
  cycle_id: null,
  cycle_started_at: null,
  cycle_target_id: null,
  cycle_target_count: null,
  cycle_checked: 0,
  last_run_at: null,
  last_run_outcome: null,
  last_complete_at: null,
  last_complete_cycle_started_at: null,
  last_cycle_duration_seconds: null,
  last_error: null,
  consecutive_failures: 0,
}

export type World = ReturnType<typeof createWorld>

/**
 * A complete fake deployment: clock, Supabase-shaped database, archive bucket
 * and a library of assets/receipts. Receipt ids are 1..n in seeding order.
 */
export function createWorld(options: { state?: Row } = {}) {
  const clock = new TestClock()
  const bucket = new FakeBucket(clock)
  const db = new FakeDb(clock)
  db.define("media_archive_audit_state", {}, [
    { ...FRESH_STATE, ...options.state },
  ])
  db.define("media_archive_receipts", {
    identity: "id",
    unique: [["asset_id", "sha256", "manifest_sha256"], ["manifest_key"]],
    appendOnly: true,
  })
  db.define("media_archive_audit_runs", {
    identity: "id",
    appendOnly: "no-update",
  })
  db.define("media_assets", { unique: [["id"]] })

  const sources = new Set<string>()
  const counters = { archived: 0 }

  db.rpcs.media_archive_missing_count = () => unarchivedReady().length
  db.rpcs.media_archive_backfill_candidates = (args) =>
    unarchivedReady()
      .slice(0, Math.max(1, Math.min(Number(args.p_limit ?? 10), 50)))
      .map((asset) => ({ asset_id: asset.id }))

  function unarchivedReady() {
    const archived = new Set(
      db.rows("media_archive_receipts").map((receipt) => receipt.asset_id)
    )
    return db
      .rows("media_assets")
      .filter(
        (asset) => asset.upload_state === "ready" && !archived.has(asset.id)
      )
  }

  function addAsset(opts: { ready?: boolean; sourceExists?: boolean } = {}) {
    const id = randomUUID()
    const size = 1024
    db.rows("media_assets").push({
      id,
      upload_state: opts.ready === false ? "processing" : "ready",
      size_bytes: size,
      validated_mime_type: "image/jpeg",
      original_path: `venue/${id}/original.jpg`,
      created_at: clock.iso(),
    })
    if (opts.sourceExists !== false) sources.add(id)
    return id
  }

  function receiptFor(assetId: string, id?: number) {
    const hash = sha256(`original-${assetId}`)
    const blobKey = `${PROJECT_REF}/blobs/sha256/${hash.slice(0, 2)}/${hash}`
    const manifest = { assetId, sha256: hash, blobKey }
    const manifestBody = new TextEncoder().encode(JSON.stringify(manifest))
    const manifestSha = sha256(manifestBody)
    const manifestKey = `${PROJECT_REF}/manifests/${assetId}/${hash}/${manifestSha}.json`
    return {
      ...(id === undefined ? {} : { id }),
      asset_id: assetId,
      sha256: hash,
      size_bytes: 1024,
      mime_type: "image/jpeg",
      source_project_ref: PROJECT_REF,
      source_key: `venue/${assetId}/original.jpg`,
      blob_key: blobKey,
      manifest_key: manifestKey,
      manifest_sha256: manifestSha,
      manifest,
      manifestSize: manifestBody.byteLength,
      manifestBody,
    }
  }

  /** Archive an asset's original into the bucket and record its receipt. */
  async function archiveAsset(assetId: string, signal?: AbortSignal) {
    const asset = db.rows("media_assets").find((row) => row.id === assetId)
    if (!asset || asset.upload_state !== "ready")
      throw new Error("archive_asset_unavailable")
    if (!sources.has(assetId)) throw new Error("archive_source_read_failed")
    const { manifestSize, manifestBody, ...receipt } = receiptFor(assetId)
    const store = bucket.store(signal)
    await store.putOriginalIfAbsent(
      receipt.blob_key,
      preparedOriginal(receipt.sha256, 1024),
      "image/jpeg"
    )
    await store.verifyOriginal(receipt.blob_key, receipt.sha256, 1024)
    await store.putManifestIfAbsent(receipt.manifest_key, manifestBody)
    await store.verifyManifest(
      receipt.manifest_key,
      receipt.manifest_sha256,
      manifestSize
    )
    await db.client.from("media_archive_receipts").upsert(receipt as never, {
      ignoreDuplicates: true,
    })
    counters.archived++
  }

  /** Receipts that already exist, with matching bucket objects (verifiable). */
  function seedReceipts(count: number) {
    const ids: number[] = []
    for (let i = 0; i < count; i++) {
      const assetId = addAsset()
      const { manifestSize, manifestBody, ...receipt } = receiptFor(assetId)
      void manifestBody
      bucket.seed(receipt.blob_key, {
        sha256: receipt.sha256,
        size: 1024,
        kind: "original",
      })
      bucket.seed(receipt.manifest_key, {
        sha256: receipt.manifest_sha256,
        size: manifestSize,
        kind: "manifest",
      })
      const row: Row = {
        ...receipt,
        id: db.nextId("media_archive_receipts"),
        archived_at: clock.iso(),
      }
      db.rows("media_archive_receipts").push(row)
      ids.push(row.id as number)
    }
    return ids
  }

  /** Put a receipt's original and manifest back in the bucket (operator repair). */
  function reseed(receiptId: number) {
    const row = db
      .rows("media_archive_receipts")
      .find((r) => r.id === receiptId)
    if (!row) throw new Error(`no receipt ${receiptId}`)
    const { manifestSize } = receiptFor(String(row.asset_id))
    bucket.seed(String(row.blob_key), {
      sha256: String(row.sha256),
      size: 1024,
      kind: "original",
    })
    bucket.seed(String(row.manifest_key), {
      sha256: String(row.manifest_sha256),
      size: manifestSize,
      kind: "manifest",
    })
  }

  /** The row the contract describes, with a stable key set. */
  const state = () => ({ ...db.rows("media_archive_audit_state")[0] })
  const setState = (patch: Row) =>
    Object.assign(db.rows("media_archive_audit_state")[0], patch)
  const runs = () =>
    db.rows("media_archive_audit_runs").map((run) => ({ ...run }))
  const maxReceiptId = () =>
    Math.max(0, ...db.rows("media_archive_receipts").map((r) => r.id as number))

  return {
    clock,
    bucket,
    db,
    service: db.client,
    sources,
    counters,
    addAsset,
    seedReceipts,
    reseed,
    archiveAsset,
    receiptFor,
    state,
    setState,
    runs,
    maxReceiptId,
    missing: () => unarchivedReady().length,
  }
}
