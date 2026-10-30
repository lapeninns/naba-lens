import { beforeAll, describe, expect, it } from "vitest"

import { getReadableAsset } from "../../lib/server/media/access"
import { finaliseAsset } from "../../lib/server/media/finalise"
import { listLibrary, listOwnMedia } from "../../lib/server/media/library"
import { reserveAsset } from "../../lib/server/media/reserve"
import { removeMediaAssetWith } from "../../lib/server/lifecycle/remove-media"
import type { MediaActor } from "../../lib/server/media/types"
import { actorFor, newKey, syntheticJpeg } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

/** Slice <-> lifecycle wiring: upload activity for cleanup, and real removal. */
describe("slice with lifecycle: upload activity and deletion", () => {
  const admin = serviceClient()
  let staffA: TestIdentity
  let staffB: TestIdentity
  let adminUser: TestIdentity
  let actorA: MediaActor
  let actorB: MediaActor
  let actorAdmin: MediaActor

  /** updated_at before a pause; the updated_at trigger forbids back-dating rows. */
  async function idle(assetId: string) {
    const before = await updatedAt(assetId)
    await new Promise((r) => setTimeout(r, 1100))
    return before
  }

  async function updatedAt(assetId: string) {
    const { data } = await admin
      .from("media_assets")
      .select("updated_at")
      .eq("id", assetId)
      .single()
    return Date.parse(data!.updated_at)
  }

  async function upload(actor: MediaActor, identity: TestIdentity) {
    const bytes = await syntheticJpeg()
    const input = {
      idempotencyKey: newKey(),
      filename: "dish.jpg",
      sizeBytes: bytes.byteLength,
      contentType: "image/jpeg",
      mediaType: "image" as const,
      preferResumable: false,
    }
    const reserved = await reserveAsset(actor, input)
    if (!reserved.ok || !reserved.token) throw new Error("reserve failed")
    await identity.client.storage
      .from("media")
      .uploadToSignedUrl(reserved.objectKey, reserved.token, bytes)
    const done = await finaliseAsset(actor, {
      assetId: reserved.assetId,
      idempotencyKey: input.idempotencyKey,
    })
    expect(done).toEqual({ ok: true, state: "ready" })
    return reserved.assetId
  }

  beforeAll(async () => {
    const venue = await createVenue(admin, "slice-life")
    staffA = await createIdentity(admin, {
      label: "life-a",
      role: "staff",
      venueId: venue.id,
    })
    staffB = await createIdentity(admin, {
      label: "life-b",
      role: "staff",
      venueId: venue.id,
    })
    adminUser = await createIdentity(admin, {
      label: "life-admin",
      role: "admin",
    })
    actorA = await actorFor(staffA)
    actorB = await actorFor(staffB)
    actorAdmin = await actorFor(adminUser)
  })

  it("a resumed reservation counts as fresh activity, so 24 h cleanup keeps it", async () => {
    const input = {
      idempotencyKey: newKey(),
      filename: "long-clip.mp4",
      sizeBytes: 150 * 1024 * 1024,
      contentType: "video/mp4",
      mediaType: "video" as const,
      preferResumable: true,
    }
    const first = await reserveAsset(actorA, input)
    if (!first.ok) throw new Error(first.message)
    const before = await idle(first.assetId)

    // The TUS transfer resumes after a day: the idempotent retry touches the row.
    const retry = await reserveAsset(actorA, input)
    expect(retry).toMatchObject({
      ok: true,
      assetId: first.assetId,
      resumable: true,
    })
    const touched = await updatedAt(first.assetId)
    expect(touched).toBeGreaterThan(before)

    const { data: candidates, error } = await admin.rpc(
      "prepare_media_cleanup",
      {
        p_abandoned_after: "24 hours",
        p_limit: 1000,
      }
    )
    expect(error).toBeNull()
    expect((candidates ?? []).map((c) => c.asset_id)).not.toContain(
      first.assetId
    )
    const { data: row } = await admin
      .from("media_assets")
      .select("deleted_at")
      .eq("id", first.assetId)
      .single()
    expect(row!.deleted_at).toBeNull()
  })

  it("finalise starting counts as activity too", async () => {
    const bytes = await syntheticJpeg()
    const input = {
      idempotencyKey: newKey(),
      filename: "late.jpg",
      sizeBytes: bytes.byteLength,
      contentType: "image/jpeg",
      mediaType: "image" as const,
      preferResumable: false,
    }
    const reserved = await reserveAsset(actorA, input)
    if (!reserved.ok) throw new Error(reserved.message)
    const before = await idle(reserved.assetId)
    // No bytes yet: finalise refuses (409) but has recorded the attempt.
    const early = await finaliseAsset(actorA, {
      assetId: reserved.assetId,
      idempotencyKey: input.idempotencyKey,
    })
    expect(early).toMatchObject({ ok: false, status: 409 })
    expect(await updatedAt(reserved.assetId)).toBeGreaterThan(before)
  })

  it("staff remove their own file from both views; other staff get 404", async () => {
    const assetId = await upload(actorA, staffA)
    expect(
      await removeMediaAssetWith(
        { user: staffB.client, service: admin },
        assetId
      )
    ).toMatchObject({ ok: false, status: 404 })
    expect((await getReadableAsset(actorAdmin, assetId)).ok).toBe(true)

    const removed = await removeMediaAssetWith(
      { user: staffA.client, service: admin },
      assetId
    )
    expect(removed).toEqual({ ok: true, assetId, storage: "removed" })

    const own = await listOwnMedia(actorA)
    expect(own.ok && own.items.some((i) => i.id === assetId)).toBe(false)
    const lib = await listLibrary(actorAdmin, {
      venueId: null,
      staffId: staffA.id,
      type: null,
    })
    expect(lib.ok && lib.items.some((i) => i.id === assetId)).toBe(false)
    expect(await getReadableAsset(actorAdmin, assetId)).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(await getReadableAsset(actorA, assetId)).toMatchObject({
      ok: false,
      status: 404,
    })
    // A retried upload with a removed asset's key is refused, not resurrected.
    expect(
      (await finaliseAsset(actorA, { assetId, idempotencyKey: newKey() })).ok
    ).toBe(false)
  })

  it("an admin removes any file", async () => {
    const assetId = await upload(actorB, staffB)
    const removed = await removeMediaAssetWith(
      { user: adminUser.client, service: admin },
      assetId
    )
    expect(removed).toMatchObject({ ok: true, assetId })
    const own = await listOwnMedia(actorB)
    expect(own.ok && own.items.some((i) => i.id === assetId)).toBe(false)
  })
})
