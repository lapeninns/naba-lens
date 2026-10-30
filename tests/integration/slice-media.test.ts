import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { beforeAll, describe, expect, it } from "vitest"

import {
  attachmentDisposition,
  getReadableAsset,
  signDerivative,
  streamOriginal,
} from "../../lib/server/media/access"
import { rpcFailure } from "../../lib/server/media/errors"
import { finaliseAsset } from "../../lib/server/media/finalise"
import {
  decodeCursor,
  listLibrary,
  listOwnMedia,
} from "../../lib/server/media/library"
import { signAvatar, updateOwnProfile } from "../../lib/server/media/profile"
import {
  reserveAsset,
  type ReserveRequest,
} from "../../lib/server/media/reserve"
import type { MediaActor } from "../../lib/server/media/types"
import { actorFor, newKey, syntheticJpeg } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

const fixture = (name: string) =>
  readFile(
    fileURLToPath(new URL(`../fixtures/media/${name}`, import.meta.url))
  ).then((b) => new Uint8Array(b))

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

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

/** Reserve, store the bytes as the browser would, and finalise. */
async function upload(
  actor: MediaActor,
  identity: TestIdentity,
  bytes: Uint8Array,
  overrides: Partial<ReserveRequest> = {}
) {
  const input = request(bytes, overrides)
  const reserved = await reserveAsset(actor, input)
  if (!reserved.ok) throw new Error(reserved.message)
  const bucket = identity.client.storage.from("media")
  const stored =
    reserved.token && !reserved.resumable
      ? await bucket.uploadToSignedUrl(
          reserved.objectKey,
          reserved.token,
          bytes,
          {
            contentType: input.contentType || "application/octet-stream",
          }
        )
      : // Resumable reservations use TUS in the browser; the same insert
        // policy applies to a standard upload by the same user.
        await bucket.upload(reserved.objectKey, bytes, {
          contentType: input.contentType || "application/octet-stream",
        })
  if (stored.error) throw stored.error
  const finalised = await finaliseAsset(actor, {
    assetId: reserved.assetId,
    idempotencyKey: input.idempotencyKey,
  })
  return { input, reserved, finalised }
}

describe("slice: reserve, upload, finalise, read (local Supabase)", () => {
  const admin = serviceClient()
  let venueA: { id: string; name: string }
  let venueB: { id: string; name: string }
  let staffA: TestIdentity
  let staffB: TestIdentity
  let adminUser: TestIdentity
  let actorA: MediaActor
  let actorB: MediaActor
  let actorAdmin: MediaActor

  beforeAll(async () => {
    venueA = await createVenue(admin, "slice-a")
    venueB = await createVenue(admin, "slice-b")
    // Same venue: isolation must come from identity, not venue.
    staffA = await createIdentity(admin, {
      label: "slice-a",
      role: "staff",
      venueId: venueA.id,
    })
    staffB = await createIdentity(admin, {
      label: "slice-b",
      role: "staff",
      venueId: venueA.id,
    })
    adminUser = await createIdentity(admin, {
      label: "slice-admin",
      role: "admin",
    })
    actorA = await actorFor(staffA)
    actorB = await actorFor(staffB)
    actorAdmin = await actorFor(adminUser)
  })

  describe("reserve", () => {
    it("derives owner, venue, id and key on the server", async () => {
      const bytes = await syntheticJpeg()
      const reserved = await reserveAsset(actorA, request(bytes))
      expect(reserved.ok).toBe(true)
      if (!reserved.ok) return
      expect(reserved.objectKey).toBe(
        `${staffA.id}/${reserved.assetId}/original.jpg`
      )
      expect(reserved.resumable).toBe(false)
      expect(reserved.uploadUrl).toContain("/storage/v1/object/upload/sign/")

      const { data: row } = await admin
        .from("media_assets")
        .select("uploader_id, venue_id, upload_state, original_path")
        .eq("id", reserved.assetId)
        .single()
      expect(row).toMatchObject({
        uploader_id: staffA.id,
        venue_id: venueA.id,
        upload_state: "uploading",
        original_path: reserved.objectKey,
      })
    })

    it("returns the same asset for a repeated key, even concurrently", async () => {
      const bytes = await syntheticJpeg()
      const input = request(bytes)
      const results = await Promise.all([
        reserveAsset(actorA, input),
        reserveAsset(actorA, input),
        reserveAsset(actorA, input),
      ])
      const ids = new Set(results.map((r) => (r.ok ? r.assetId : r.message)))
      expect(ids.size).toBe(1)
      const again = await reserveAsset(actorA, input)
      expect(again.ok && again.assetId).toBe([...ids][0])

      const { count } = await admin
        .from("media_assets")
        .select("id", { count: "exact", head: true })
        .eq("uploader_id", staffA.id)
        .eq("client_upload_key", input.idempotencyKey)
      expect(count).toBe(1)
    })

    it("scopes keys per uploader: another staff member's key makes a new asset", async () => {
      const bytes = await syntheticJpeg()
      const input = request(bytes)
      const mine = await reserveAsset(actorA, input)
      const theirs = await reserveAsset(actorB, input)
      expect(mine.ok && theirs.ok).toBe(true)
      if (!mine.ok || !theirs.ok) return
      expect(theirs.assetId).not.toBe(mine.assetId)
      expect(theirs.objectKey.startsWith(`${staffB.id}/`)).toBe(true)
    })

    it("re-checks size and type limits on the server", async () => {
      const big = await reserveAsset(actorA, {
        ...request(new Uint8Array(1)),
        sizeBytes: 21 * 1024 * 1024,
      })
      expect(big).toMatchObject({ ok: false, status: 400 })
      const exe = await reserveAsset(actorA, {
        ...request(new Uint8Array(1)),
        filename: "tool.exe",
        contentType: "application/octet-stream",
      })
      expect(exe).toMatchObject({ ok: false, status: 400 })
      const noKey = await reserveAsset(actorA, {
        ...request(new Uint8Array(1)),
        idempotencyKey: "x",
      })
      expect(noKey).toMatchObject({ ok: false, status: 400 })
    })

    it("an admin cannot reserve, and a deactivated session is refused by the database", async () => {
      const bytes = await syntheticJpeg()
      expect(await reserveAsset(actorAdmin, request(bytes))).toMatchObject({
        ok: false,
        status: 403,
      })
      const leaver = await createIdentity(admin, {
        label: "slice-leaver",
        role: "staff",
        venueId: venueA.id,
      })
      const stale = await actorFor(leaver) // profile read while still active
      await admin.from("profiles").update({ active: false }).eq("id", leaver.id)
      expect(await reserveAsset(stale, request(bytes))).toMatchObject({
        ok: false,
        status: 403,
      })
    })
  })

  describe("finalise", () => {
    it("validates the stored JPEG, writes derivatives and is idempotent", async () => {
      const bytes = await syntheticJpeg(1200, 900)
      const { reserved, finalised, input } = await upload(actorA, staffA, bytes)
      expect(finalised).toEqual({ ok: true, state: "ready" })
      if (!reserved.ok) return

      const { data: row } = await admin
        .from("media_assets")
        .select("*")
        .eq("id", reserved.assetId)
        .single()
      expect(row).toMatchObject({
        upload_state: "ready",
        validated_mime_type: "image/jpeg",
        size_bytes: bytes.byteLength,
        width: 1200,
        height: 900,
        preview_path: `${staffA.id}/${reserved.assetId}/preview.webp`,
        thumbnail_path: `${staffA.id}/${reserved.assetId}/thumb.webp`,
      })

      // Repeated and concurrent finalise calls change nothing.
      const again = await Promise.all([
        finaliseAsset(actorA, {
          assetId: reserved.assetId,
          idempotencyKey: input.idempotencyKey,
        }),
        finaliseAsset(actorA, {
          assetId: reserved.assetId,
          idempotencyKey: input.idempotencyKey,
        }),
      ])
      expect(again).toEqual([
        { ok: true, state: "ready" },
        { ok: true, state: "ready" },
      ])
      // A retried reserve with the same key reports ready: no second asset.
      const retry = await reserveAsset(actorA, input)
      expect(retry).toMatchObject({ assetId: reserved.assetId, state: "ready" })
    })

    it("two concurrent first finalise calls both settle on one ready asset", async () => {
      const bytes = await syntheticJpeg()
      const input = request(bytes)
      const reserved = await reserveAsset(actorA, input)
      if (!reserved.ok || !reserved.token) throw new Error("reserve failed")
      await staffA.client.storage
        .from("media")
        .uploadToSignedUrl(reserved.objectKey, reserved.token, bytes)
      const both = await Promise.all([
        finaliseAsset(actorA, {
          assetId: reserved.assetId,
          idempotencyKey: input.idempotencyKey,
        }),
        finaliseAsset(actorA, {
          assetId: reserved.assetId,
          idempotencyKey: input.idempotencyKey,
        }),
      ])
      expect(both).toEqual([
        { ok: true, state: "ready" },
        { ok: true, state: "ready" },
      ])
    })

    it("converts HEIC (first top-level image) and stores the sniffed type", async () => {
      const bytes = await fixture("synthetic-12mp.heic")
      const { reserved, finalised } = await upload(actorA, staffA, bytes, {
        filename: "IMG_0001.HEIC",
        contentType: "",
      })
      expect(finalised).toEqual({ ok: true, state: "ready" })
      if (!reserved.ok) return
      // Over 6 MiB would be resumable; this fixture is small.
      const { data } = await admin
        .from("media_assets")
        .select("validated_mime_type, width, height")
        .eq("id", reserved.assetId)
        .single()
      expect(data).toEqual({
        validated_mime_type: "image/heic",
        width: 4000,
        height: 3000,
      })
    })

    it("probes a video by Range reads and stores its metadata", async () => {
      const bytes = await fixture("synthetic.mp4")
      const { reserved, finalised } = await upload(actorA, staffA, bytes, {
        filename: "clip.mp4",
        contentType: "video/mp4",
        mediaType: "video",
      })
      expect(reserved.ok && reserved.resumable).toBe(true)
      expect(finalised).toEqual({ ok: true, state: "ready" })
      if (!reserved.ok) return
      const { data } = await admin
        .from("media_assets")
        .select(
          "validated_mime_type, width, height, duration_seconds, thumbnail_path"
        )
        .eq("id", reserved.assetId)
        .single()
      expect(data).toMatchObject({
        validated_mime_type: "video/mp4",
        width: 320,
        height: 240,
        thumbnail_path: null,
      })
      expect(Number(data!.duration_seconds)).toBeCloseTo(0.2, 1)
    })

    it("never marks failed validation ready (disguised, corrupt, wrong kind)", async () => {
      const html = new TextEncoder().encode(
        "<html><script>alert(1)</script></html>"
      )
      const disguised = await upload(actorA, staffA, html, {
        filename: "menu.jpg",
      })
      expect(disguised.finalised).toMatchObject({ ok: true, state: "failed" })

      const jpeg = await syntheticJpeg()
      const corrupt = await upload(
        actorA,
        staffA,
        jpeg.subarray(0, Math.floor(jpeg.byteLength / 3))
      )
      expect(corrupt.finalised).toMatchObject({ ok: true, state: "failed" })

      // Real PNG bytes reserved as a video: content must match the reserved kind.
      const png = await fixture("synthetic-12mp.png")
      const wrongKind = await upload(actorA, staffA, png, {
        filename: "clip.mp4",
        contentType: "video/mp4",
        mediaType: "video",
      })
      expect(wrongKind.finalised).toMatchObject({ ok: true, state: "failed" })

      for (const attempt of [disguised, corrupt, wrongKind]) {
        if (!attempt.reserved.ok) throw new Error("reserve failed")
        const { data } = await admin
          .from("media_assets")
          .select("upload_state, validated_mime_type, preview_path")
          .eq("id", attempt.reserved.assetId)
          .single()
        expect(data).toEqual({
          upload_state: "failed",
          validated_mime_type: null,
          preview_path: null,
        })
        // Terminal failure removes the original at once (upload-path review
        // F4); a repeated finalise stays failed, and a retry through reserve
        // reopens the reservation for a fresh transfer.
        const { data: left } = await admin.storage
          .from("media")
          .list(`${staffA.id}/${attempt.reserved.assetId}`)
        expect(left).toEqual([])
        const again = await finaliseAsset(actorA, {
          assetId: attempt.reserved.assetId,
          idempotencyKey: attempt.input.idempotencyKey,
        })
        expect(again).toMatchObject({ ok: true, state: "failed" })
        const retry = await reserveAsset(actorA, attempt.input)
        expect(retry).toMatchObject({ ok: true, state: "uploading" })
        // Not readable or downloadable by anyone.
        expect(
          (await getReadableAsset(actorAdmin, attempt.reserved.assetId)).ok
        ).toBe(false)
      }
    })

    it("finalise before the bytes arrive keeps the reservation open", async () => {
      const bytes = await syntheticJpeg()
      const input = request(bytes)
      const reserved = await reserveAsset(actorA, input)
      if (!reserved.ok || !reserved.token) throw new Error("reserve failed")
      const early = await finaliseAsset(actorA, {
        assetId: reserved.assetId,
        idempotencyKey: input.idempotencyKey,
      })
      expect(early).toMatchObject({ ok: false, status: 409 })
      // Still uploadable, then finalises normally.
      const stored = await staffA.client.storage
        .from("media")
        .uploadToSignedUrl(reserved.objectKey, reserved.token, bytes)
      expect(stored.error).toBeNull()
      expect(
        await finaliseAsset(actorA, {
          assetId: reserved.assetId,
          idempotencyKey: input.idempotencyKey,
        })
      ).toEqual({ ok: true, state: "ready" })
    })
  })

  describe("isolation and admin access", () => {
    let assetId: string
    let original: Uint8Array

    beforeAll(async () => {
      original = await syntheticJpeg(800, 600)
      const { reserved, finalised } = await upload(actorA, staffA, original)
      if (!reserved.ok || !finalised.ok) throw new Error("upload failed")
      assetId = reserved.assetId
    })

    it("staff B (same venue) cannot finalise, sign, read, list or delete A's asset", async () => {
      expect(
        await finaliseAsset(actorB, { assetId, idempotencyKey: newKey() })
      ).toMatchObject({ ok: false, status: 404 })
      expect(await signDerivative(actorB, assetId, "thumbnail")).toMatchObject({
        ok: false,
        status: 404,
      })
      expect(await getReadableAsset(actorB, assetId)).toMatchObject({
        ok: false,
        status: 404,
      })
      const own = await listOwnMedia(actorB)
      expect(own.ok && own.items.some((i) => i.id === assetId)).toBe(false)

      const { data: row } = await admin
        .from("media_assets")
        .select("original_path, preview_path")
        .eq("id", assetId)
        .single()
      for (const path of [row!.original_path, row!.preview_path!]) {
        const signed = await staffB.client.storage
          .from("media")
          .createSignedUrl(path, 60)
        expect(signed.error).not.toBeNull()
        const download = await staffB.client.storage
          .from("media")
          .download(path)
        expect(download.error).not.toBeNull()
      }

      const deletion = await staffB.client.rpc("delete_media_asset", {
        p_asset_id: assetId,
      })
      expect(deletion.error?.message).toContain("media_asset_not_found")
      expect(rpcFailure(deletion.error)).toMatchObject({ status: 404 })
      // The RPC's raw HTTP status is 500; the app maps it to 404.
      expect(deletion.status).toBe(500)
    })

    it("staff A sees the asset in their own portfolio with a thumbnail route", async () => {
      const own = await listOwnMedia(actorA)
      expect(own.ok).toBe(true)
      if (!own.ok) return
      const item = own.items.find((i) => i.id === assetId)
      expect(item).toMatchObject({
        uploadState: "ready",
        contributorId: staffA.id,
        venueName: venueA.name,
        thumbnailUrl: `/api/media/${assetId}/thumb`,
        previewUrl: `/api/media/${assetId}/preview`,
      })
      const signed = await signDerivative(actorA, assetId, "thumbnail")
      expect(signed.ok).toBe(true)
      if (!signed.ok) return
      expect(signed.url).toMatch(/[?&]token=/)
      const res = await fetch(signed.url)
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("image/webp")
    })

    it("a different admin sees it and downloads byte-identical original bytes", async () => {
      const library = await listLibrary(actorAdmin, {
        venueId: venueA.id,
        staffId: staffA.id,
        type: "image",
      })
      expect(library.ok && library.items.map((i) => i.id)).toContain(assetId)

      const found = await getReadableAsset(actorAdmin, assetId)
      if (!found.ok) throw new Error(found.message)
      const response = await streamOriginal(actorAdmin, found.asset, null)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/jpeg")
      expect(response.headers.get("content-disposition")).toMatch(
        /^attachment; filename="dish\.jpg"/
      )
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      const downloaded = new Uint8Array(await response.arrayBuffer())
      expect(sha256(downloaded)).toBe(sha256(original))

      const partial = await streamOriginal(actorAdmin, found.asset, "bytes=0-9")
      expect(partial.status).toBe(206)
      expect(new Uint8Array(await partial.arrayBuffer())).toEqual(
        original.subarray(0, 10)
      )
    })

    it("download filenames always carry the validated extension", () => {
      expect(attachmentDisposition("menu.html", "image/jpeg")).toBe(
        `attachment; filename="menu.jpg"; filename*=UTF-8''menu.jpg`
      )
      expect(attachmentDisposition('a"b\\c/é.png', "image/png")).toBe(
        `attachment; filename="abc_.png"; filename*=UTF-8''abc%C3%A9.png`
      )
    })
  })

  describe("attribution after a venue transfer", () => {
    it("keeps old uploads at venue A and puts new ones at venue B", async () => {
      const mover = await createIdentity(admin, {
        label: "slice-mover",
        role: "staff",
        venueId: venueA.id,
      })
      const before = await upload(
        await actorFor(mover),
        mover,
        await syntheticJpeg()
      )
      if (!before.reserved.ok) throw new Error("reserve failed")

      await admin
        .from("profiles")
        .update({ venue_id: venueB.id })
        .eq("id", mover.id)
      const moved = await actorFor(mover)
      const after = await upload(moved, mover, await syntheticJpeg())
      if (!after.reserved.ok) throw new Error("reserve failed")

      // Retrying the pre-transfer key still returns the venue-A asset.
      const retry = await reserveAsset(moved, before.input)
      expect(retry).toMatchObject({ assetId: before.reserved.assetId })

      const { data } = await admin
        .from("media_assets")
        .select("id, venue_id")
        .in("id", [before.reserved.assetId, after.reserved.assetId])
      const venueOf = new Map(data!.map((r) => [r.id, r.venue_id]))
      expect(venueOf.get(before.reserved.assetId)).toBe(venueA.id)
      expect(venueOf.get(after.reserved.assetId)).toBe(venueB.id)

      const atA = await listLibrary(actorAdmin, {
        venueId: venueA.id,
        staffId: mover.id,
        type: null,
      })
      expect(atA.ok && atA.items.map((i) => i.id)).toEqual([
        before.reserved.assetId,
      ])
      const own = await listOwnMedia(moved)
      expect(own.ok && own.items.map((i) => i.venueName)).toEqual([
        venueB.name,
        venueA.name,
      ])
    })
  })

  describe("library pagination and filters", () => {
    it("pages 24 at a time with a stable cursor and combined filters", async () => {
      const venue = await createVenue(admin, "slice-page")
      const prolific = await createIdentity(admin, {
        label: "slice-page",
        role: "staff",
        venueId: venue.id,
      })
      const ids: string[] = []
      for (let i = 0; i < 27; i++) {
        const { data, error } = await prolific.client.rpc(
          "reserve_media_asset",
          {
            p_media_type: i % 9 === 0 ? "video" : "image",
            p_extension: i % 9 === 0 ? "mp4" : "jpg",
            p_original_filename: `item-${i}`,
          }
        )
        if (error) throw error
        await markReady(
          admin,
          data[0].id,
          i % 9 === 0 ? "video/mp4" : "image/jpeg"
        )
        ids.push(data[0].id)
      }
      const filters = { venueId: venue.id, staffId: null, type: null }
      const first = await listLibrary(actorAdmin, filters)
      if (!first.ok) throw new Error(first.message)
      expect(first.items).toHaveLength(24)
      expect(first.nextCursor).not.toBeNull()
      expect(decodeCursor(first.nextCursor)).not.toBeNull()
      const second = await listLibrary(actorAdmin, filters, first.nextCursor)
      if (!second.ok) throw new Error(second.message)
      expect(second.items).toHaveLength(3)
      expect(second.nextCursor).toBeNull()
      const all = [...first.items, ...second.items].map((i) => i.id)
      expect(new Set(all).size).toBe(27)
      expect([...all].sort()).toEqual([...ids].sort())

      const videos = await listLibrary(actorAdmin, {
        venueId: venue.id,
        staffId: prolific.id,
        type: "video",
      })
      expect(videos.ok && videos.items.map((i) => i.mediaType)).toEqual([
        "video",
        "video",
        "video",
      ])
      const none = await listLibrary(actorAdmin, {
        venueId: venueB.id,
        staffId: prolific.id,
        type: null,
      })
      expect(none.ok && none.items).toEqual([])

      expect(
        await listLibrary(actorAdmin, filters, "not-a-cursor")
      ).toMatchObject({
        ok: false,
        status: 400,
      })
      // Staff never get the library, admins never get a "portfolio" of their own.
      expect(await listLibrary(actorA, filters)).toMatchObject({
        ok: false,
        status: 403,
      })
      expect(await listOwnMedia(actorAdmin)).toMatchObject({
        ok: false,
        status: 403,
      })
    })
  })

  describe("own profile", () => {
    it("updates name and avatar; avatars are readable by owner and admin only", async () => {
      const result = await updateOwnProfile(actorA, {
        displayName: "TEST slice-a renamed",
        avatar: await syntheticJpeg(900, 700),
      })
      expect(result).toEqual({ ok: true })
      const { data } = await admin
        .from("profiles")
        .select("display_name, avatar_path, role, venue_id, active")
        .eq("id", staffA.id)
        .single()
      expect(data).toMatchObject({
        display_name: "TEST slice-a renamed",
        role: "staff",
        venue_id: venueA.id,
        active: true,
      })
      expect(data!.avatar_path).toMatch(
        new RegExp(`^${staffA.id}/[0-9a-f-]{36}\\.webp$`)
      )

      const mine = await signAvatar(await actorFor(staffA), staffA.id)
      expect(mine.ok).toBe(true)
      expect((await signAvatar(actorAdmin, staffA.id)).ok).toBe(true)
      expect(await signAvatar(actorB, staffA.id)).toMatchObject({
        ok: false,
        status: 404,
      })

      expect(
        await updateOwnProfile(actorA, { displayName: "  ", avatar: null })
      ).toMatchObject({ ok: false, status: 400 })
      expect(
        await updateOwnProfile(actorA, {
          displayName: "ok",
          avatar: new TextEncoder().encode("<svg/>"),
        })
      ).toMatchObject({ ok: false, status: 400 })
    })
  })
})
