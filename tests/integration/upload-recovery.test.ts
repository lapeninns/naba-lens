import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"

import { beforeAll, describe, expect, it } from "vitest"

import { runMediaCleanup } from "../../lib/server/lifecycle/cleanup"
import { finaliseAsset } from "../../lib/server/media/finalise"
import {
  reserveAsset,
  type ReserveRequest,
} from "../../lib/server/media/reserve"
import type { MediaActor } from "../../lib/server/media/types"
import { actorFor, newKey, syntheticJpeg } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

/**
 * Upload recovery against the LOCAL stack (spec §5, §10 "Partial batch",
 * "Interrupted upload", "Content validation"): retries reuse the reserved asset,
 * finalise is idempotent, cancelled reservations are cleaned up later, and
 * nothing that fails validation becomes `ready`.
 */

type Fixtures = { dir: string; files: Record<string, string> }
let fixtures: Fixtures
const fixture = async (name: string) =>
  new Uint8Array(await readFile(fixtures.files[name.replace(/[.-]/g, "_")]))

const HOUR = 60 * 60 * 1000

function request(
  bytes: Uint8Array,
  overrides: Partial<ReserveRequest> = {}
): ReserveRequest {
  return {
    idempotencyKey: newKey(),
    filename: "dish.jpg",
    sizeBytes: bytes.byteLength,
    contentType: "image/jpeg",
    mediaType: "image",
    preferResumable: false,
    ...overrides,
  }
}

describe("upload recovery (local Supabase)", () => {
  const admin = serviceClient()
  let staff: TestIdentity
  let actor: MediaActor

  /** Stores bytes at a reserved key as the browser does (signed PUT). */
  async function put(objectKey: string, token: string, bytes: Uint8Array) {
    const { error } = await staff.client.storage
      .from("media")
      .uploadToSignedUrl(objectKey, token, bytes, {
        contentType: "application/octet-stream",
      })
    if (error) throw error
  }

  async function rowsFor(key: string) {
    const { data, error } = await admin
      .from("media_assets")
      .select(
        "id, upload_state, deleted_at, updated_at, preview_path, thumbnail_path, validated_mime_type"
      )
      .eq("uploader_id", staff.id)
      .eq("client_upload_key", key)
    if (error) throw error
    return data
  }

  async function objectsUnder(assetId: string) {
    const { data, error } = await admin.storage
      .from("media")
      .list(`${staff.id}/${assetId}`)
    if (error) throw error
    return data.map((o) => o.name).sort()
  }

  beforeAll(async () => {
    const out = execFileSync(
      process.execPath,
      ["tests/fixtures/uploads/generate.mjs"],
      { encoding: "utf8" }
    )
    fixtures = JSON.parse(out) as Fixtures
    const venue = await createVenue(admin, "upload-recovery")
    staff = await createIdentity(admin, {
      label: "upload-recovery",
      role: "staff",
      venueId: venue.id,
    })
    actor = await actorFor(staff)
  }, 120_000)

  describe("retry after a network failure", () => {
    it("a failed transfer retried with the same key reuses the asset; no duplicate row", async () => {
      const bytes = await syntheticJpeg()
      const input = request(bytes)
      const first = await reserveAsset(actor, input)
      expect(first.ok).toBe(true)
      if (!first.ok) return
      // The transfer never reached storage (network failure). Retry.
      const second = await reserveAsset(actor, input)
      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.assetId).toBe(first.assetId)
      expect(second.objectKey).toBe(first.objectKey)
      expect(second.state).toBe("uploading")
      // A fresh signed URL per attempt for the same key.
      expect(second.token).toBeTruthy()
      await put(second.objectKey, second.token!, bytes)
      const done = await finaliseAsset(actor, {
        assetId: second.assetId,
        idempotencyKey: input.idempotencyKey,
      })
      expect(done).toEqual({ ok: true, state: "ready" })
      const rows = await rowsFor(input.idempotencyKey)
      expect(rows).toHaveLength(1)
      expect(rows[0].upload_state).toBe("ready")
    })

    it("a lost response after the bytes were stored skips the transfer and finalises the same asset", async () => {
      const bytes = await syntheticJpeg()
      const input = request(bytes)
      const first = await reserveAsset(actor, input)
      if (!first.ok) throw new Error(first.message)
      await put(first.objectKey, first.token!, bytes)
      // Browser never saw the PUT response; it retries the whole file.
      const retry = await reserveAsset(actor, input)
      expect(retry).toMatchObject({
        ok: true,
        assetId: first.assetId,
        state: "processing",
        resumable: false,
      })
      // A second PUT to the same key is refused (no overwrite), which the
      // transport treats as "already stored".
      const again = await staff.client.storage
        .from("media")
        .uploadToSignedUrl(first.objectKey, first.token!, bytes)
      expect(again.error).not.toBeNull()
      const done = await finaliseAsset(actor, {
        assetId: first.assetId,
        idempotencyKey: input.idempotencyKey,
      })
      expect(done).toEqual({ ok: true, state: "ready" })
      expect(await rowsFor(input.idempotencyKey)).toHaveLength(1)
    })

    it("finalise before any bytes arrived keeps the reservation open for the retry", async () => {
      const bytes = await syntheticJpeg()
      const input = request(bytes)
      const reserved = await reserveAsset(actor, input)
      if (!reserved.ok) throw new Error(reserved.message)
      const early = await finaliseAsset(actor, {
        assetId: reserved.assetId,
        idempotencyKey: input.idempotencyKey,
      })
      expect(early).toMatchObject({ ok: false, status: 409 })
      expect((await rowsFor(input.idempotencyKey))[0].upload_state).toBe(
        "uploading"
      )
      await put(reserved.objectKey, reserved.token!, bytes)
      expect(
        await finaliseAsset(actor, {
          assetId: reserved.assetId,
          idempotencyKey: input.idempotencyKey,
        })
      ).toEqual({ ok: true, state: "ready" })
    })
  })

  describe("duplicate finalise", () => {
    it("a repeated finalise is a no-op once ready", async () => {
      const bytes = await syntheticJpeg()
      const input = request(bytes)
      const reserved = await reserveAsset(actor, input)
      if (!reserved.ok) throw new Error(reserved.message)
      await put(reserved.objectKey, reserved.token!, bytes)
      const call = () =>
        finaliseAsset(actor, {
          assetId: reserved.assetId,
          idempotencyKey: input.idempotencyKey,
        })
      expect(await call()).toEqual({ ok: true, state: "ready" })
      const [before] = await rowsFor(input.idempotencyKey)
      const objects = await objectsUnder(reserved.assetId)
      expect(objects).toEqual(["original.jpg", "preview.webp", "thumb.webp"])

      expect(await call()).toEqual({ ok: true, state: "ready" })
      const [after] = await rowsFor(input.idempotencyKey)
      // Not re-processed: the row was not written again.
      expect(after).toEqual(before)
      expect(await objectsUnder(reserved.assetId)).toEqual(objects)
      // reserve on a ready asset also skips the transfer.
      expect(await reserveAsset(actor, input)).toMatchObject({
        ok: true,
        assetId: reserved.assetId,
        state: "ready",
      })
    })

    it("concurrent finalise calls produce one ready asset", async () => {
      const bytes = await syntheticJpeg()
      const input = request(bytes)
      const reserved = await reserveAsset(actor, input)
      if (!reserved.ok) throw new Error(reserved.message)
      await put(reserved.objectKey, reserved.token!, bytes)
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          finaliseAsset(actor, {
            assetId: reserved.assetId,
            idempotencyKey: input.idempotencyKey,
          })
        )
      )
      for (const r of results) expect(r).toEqual({ ok: true, state: "ready" })
      const rows = await rowsFor(input.idempotencyKey)
      expect(rows).toHaveLength(1)
      expect(rows[0].upload_state).toBe("ready")
    })

    it("finalise with another reservation's key is refused", async () => {
      const bytes = await syntheticJpeg()
      const input = request(bytes)
      const reserved = await reserveAsset(actor, input)
      if (!reserved.ok) throw new Error(reserved.message)
      await put(reserved.objectKey, reserved.token!, bytes)
      expect(
        await finaliseAsset(actor, {
          assetId: reserved.assetId,
          idempotencyKey: newKey(),
        })
      ).toMatchObject({ ok: false, status: 404 })
      expect((await rowsFor(input.idempotencyKey))[0].upload_state).toBe(
        "uploading"
      )
    })
  })

  describe("cancel", () => {
    it("cancelled before and during upload: never finalised, cleaned after the window, live ones kept", async () => {
      const bytes = await syntheticJpeg()
      // Before: reserved, nothing stored.
      const beforeInput = request(bytes)
      const before = await reserveAsset(actor, beforeInput)
      if (!before.ok) throw new Error(before.message)
      // During: the transfer stored bytes, then the browser cancelled, so
      // finalise never ran (lib/upload checks the signal before finalising).
      const duringInput = request(bytes)
      const during = await reserveAsset(actor, duringInput)
      if (!during.ok) throw new Error(during.message)
      await put(during.objectKey, during.token!, bytes)

      for (const key of [
        beforeInput.idempotencyKey,
        duringInput.idempotencyKey,
      ])
        expect((await rowsFor(key))[0].upload_state).toBe("uploading")

      // Inside the 24 h window nothing is touched.
      const early = await runMediaCleanup(admin, {
        now: new Date(Date.now() + 1 * HOUR),
      })
      expect(early.status).toBe("completed")
      for (const key of [
        beforeInput.idempotencyKey,
        duringInput.idempotencyKey,
      ])
        expect((await rowsFor(key))[0].deleted_at).toBeNull()

      // After the window both are tombstoned and the stored bytes removed.
      const late = await runMediaCleanup(admin, {
        now: new Date(Date.now() + 25 * HOUR),
      })
      expect(late.status).toBe("completed")
      for (const key of [
        beforeInput.idempotencyKey,
        duringInput.idempotencyKey,
      ]) {
        const [row] = await rowsFor(key)
        expect(row.deleted_at).not.toBeNull()
        expect(row.upload_state).toBe("uploading")
      }
      expect(await objectsUnder(during.assetId)).toEqual([])
      // A retry of a cleaned reservation is refused rather than reviving it.
      expect(await reserveAsset(actor, beforeInput)).toMatchObject({
        ok: false,
        status: 404,
      })
    })
  })

  describe("content validation: nothing invalid becomes ready", () => {
    async function uploadAs(
      name: string,
      bytes: Uint8Array,
      overrides: Partial<ReserveRequest> = {}
    ) {
      const input = request(bytes, { filename: name, ...overrides })
      const reserved = await reserveAsset(actor, input)
      if (!reserved.ok) return { reserved, input, finalised: null }
      if (reserved.token) await put(reserved.objectKey, reserved.token, bytes)
      else
        await staff.client.storage
          .from("media")
          .upload(reserved.objectKey, bytes)
      const finalised = await finaliseAsset(actor, {
        assetId: reserved.assetId,
        idempotencyKey: input.idempotencyKey,
      })
      return { reserved, input, finalised }
    }

    it.each([
      ["disguised.jpg", "This file type is not supported."],
      ["corrupt.jpg", "This file is damaged or could not be read."],
    ])("%s fails with a reason", async (name, reason) => {
      const { input, finalised } = await uploadAs(name, await fixture(name))
      expect(finalised).toMatchObject({ ok: true, state: "failed" })
      expect((finalised as { error: string }).error).toContain(reason)
      const [row] = await rowsFor(input.idempotencyKey)
      expect(row.upload_state).toBe("failed")
      expect(row.validated_mime_type).toBeNull()
      // Failed again on a retry, still one row, still not ready.
      const again = await finaliseAsset(actor, {
        assetId: row.id,
        idempotencyKey: input.idempotencyKey,
      })
      expect(again).toMatchObject({ ok: true, state: "failed" })
      expect(await rowsFor(input.idempotencyKey)).toHaveLength(1)
    })

    it("an oversized photo is refused at reserve, and bytes smuggled past a small declared size fail", async () => {
      const big = await fixture("oversized.jpg")
      expect(big.byteLength).toBeGreaterThan(20 * 1024 * 1024)
      expect(
        await reserveAsset(actor, request(big, { filename: "big.jpg" }))
      ).toMatchObject({ ok: false, status: 400 })
      // Lie about the size; the server measures the stored object.
      const { input, finalised } = await uploadAs("big.jpg", big, {
        sizeBytes: 1000,
      })
      expect(finalised).toMatchObject({
        ok: true,
        state: "failed",
        error: "This file is larger than the upload limit.",
      })
      expect((await rowsFor(input.idempotencyKey))[0].upload_state).toBe(
        "failed"
      )
    })

    it("a photo declared as a video fails the type check", async () => {
      const bytes = await syntheticJpeg()
      const { input, finalised } = await uploadAs("clip.mp4", bytes, {
        mediaType: "video",
        contentType: "video/mp4",
      })
      expect(finalised).toMatchObject({ ok: true, state: "failed" })
      expect((await rowsFor(input.idempotencyKey))[0].upload_state).toBe(
        "failed"
      )
    })

    it("no row of this uploader is ready without a validated type and size", async () => {
      const { data } = await admin
        .from("media_assets")
        .select("id, upload_state, validated_mime_type, size_bytes")
        .eq("uploader_id", staff.id)
        .eq("upload_state", "ready")
      for (const row of data ?? []) {
        expect(row.validated_mime_type).toBeTruthy()
        expect(row.size_bytes).toBeGreaterThan(0)
      }
    })
  })
})
