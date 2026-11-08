// Labels stored on the server while a photo is still uploading (upload flow
// Phase 2, contract C1/C2), against the LOCAL stack: POST /api/upload-labels
// stores a draft for an uploading/processing asset, finalise applies it as
// the uploader in the same transaction that makes the asset ready, a problem
// becomes `needs_attention` without blocking the photo, and drafts follow the
// asset's removal and the 24 h abandoned-upload cleanup. Contract C6: a
// temporarily failed upload keeps (and accepts) its labels and lists them as
// `retryable`; DELETE says whether it discarded anything or finalise applied
// the labels first; only the uploader's own save settles their stored labels;
// a lock wait during the apply never fails the finalise.
//
// The route handlers run in-process. getMediaActor is replaced by the same
// MediaActor the app builds (tests/slice/media-actor.ts) because it reads
// cookies in Next; every read and write still goes through the caller's RLS
// client. The service role only arranges state and reads rows back.
import { execFileSync, spawn } from "node:child_process"

import { createClient } from "@supabase/supabase-js"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { DELETE, GET, POST } from "../../app/api/upload-labels/route"
import type { Database } from "../../lib/db/types"
import type {
  PendingLabelItem,
  SaveLabelsInput,
  UploadLabelDiscardResult,
  UploadLabelPostResult,
} from "../../lib/menus/types"
import { runMediaCleanup } from "../../lib/server/lifecycle/cleanup"
import { removeMediaAssetWith } from "../../lib/server/lifecycle/remove-media"
import {
  finaliseAsset,
  type FinaliseResponse,
} from "../../lib/server/media/finalise"
import { reserveAsset } from "../../lib/server/media/reserve"
import type { MediaActor, Outcome } from "../../lib/server/media/types"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  section,
  type CatalogueRow,
} from "../security/menus-fixtures"
import { actorFor, newKey, syntheticJpeg } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"

const session = vi.hoisted(() => ({ actor: null as MediaActor | null }))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: async () =>
    session.actor
      ? { ok: true, actor: session.actor }
      : { ok: false, status: 401, message: "Sign in to continue." },
}))

const HOUR = 60 * 60 * 1000
const ORIGIN = "http://localhost:3000"
const service = serviceClient()

let venueA: string
let admin: TestIdentity
let staffA: TestIdentity
let staffA2: TestIdentity
let actorA: MediaActor
let actorA2: MediaActor
let v1: string
let rows: Record<string, CatalogueRow>

/**
 * A service client that runs `before` ahead of each request and `after` once
 * its response arrived: places a competing POST at an exact point in finalise.
 */
function interceptedService(
  before?: (url: string) => Promise<void>,
  after?: (url: string) => Promise<void>
) {
  const env = getLocalSupabaseEnv()
  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, init) => {
        await before?.(String(url))
        const res = await fetch(url, init)
        await after?.(String(url))
        return res
      },
    },
  })
}

const ref = (row: CatalogueRow) => ({ itemId: row.itemId, variantId: null })

function input(
  assetId: string,
  patch: Partial<SaveLabelsInput> = {}
): SaveLabelsInput {
  return {
    assetId,
    expectedRevision: 0,
    catalogueVersionId: v1,
    contentTypes: ["dish"],
    note: null,
    items: [ref(rows.bhaji)],
    missingItem: null,
    ...patch,
  }
}

async function post(actor: MediaActor, venueId: string, body: SaveLabelsInput) {
  session.actor = actor
  const res = await POST(
    new Request(`${ORIGIN}/api/upload-labels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ venueId, input: body }),
    })
  )
  return {
    status: res.status,
    body: (await res.json()) as UploadLabelPostResult,
  }
}

async function attention(actor: MediaActor) {
  session.actor = actor
  const res = await GET(new Request(`${ORIGIN}/api/upload-labels?attention=1`))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: true; items: PendingLabelItem[] }
  expect(body.ok).toBe(true)
  return body.items
}

async function discard(actor: MediaActor, assetId: string) {
  session.actor = actor
  const res = await DELETE(
    new Request(`${ORIGIN}/api/upload-labels?assetId=${assetId}`, {
      method: "DELETE",
    })
  )
  return {
    status: res.status,
    body: (await res.json()) as
      UploadLabelDiscardResult | { ok: false; message: string },
  }
}

/** Reserves (and, unless `transfer` is false, stores) a fresh JPEG. */
async function upload(
  actor: MediaActor,
  identity: TestIdentity,
  transfer = true
) {
  const bytes = await syntheticJpeg(64, 48)
  const key = newKey()
  const reserved = await reserveAsset(actor, {
    idempotencyKey: key,
    filename: "dish.jpg",
    sizeBytes: bytes.byteLength,
    contentType: "image/jpeg",
    mediaType: "image",
    preferResumable: false,
  })
  if (!reserved.ok) throw new Error(reserved.message)
  if (transfer) {
    const { error } = await identity.client.storage
      .from("media")
      .uploadToSignedUrl(reserved.objectKey, reserved.token!, bytes, {
        contentType: "application/octet-stream",
      })
    if (error) throw error
  }
  return { assetId: reserved.assetId, key }
}

function finalise(actor: MediaActor, a: { assetId: string; key: string }) {
  return finaliseAsset(actor, { assetId: a.assetId, idempotencyKey: a.key })
}

async function draftRow(assetId: string) {
  const { data, error } = await service
    .from("media_pending_labels")
    .select("status, code, uploader_id, input")
    .eq("asset_id", assetId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function uploadState(assetId: string) {
  const { data, error } = await service
    .from("media_assets")
    .select("upload_state")
    .eq("id", assetId)
    .single()
  if (error) throw error
  return data.upload_state
}

/** Marks an asset failed, as finalise does on a temporary failure (bytes kept). */
async function failTemporarily(assetId: string) {
  const { error } = await service
    .from("media_assets")
    .update({ upload_state: "failed" })
    .eq("id", assetId)
  if (error) throw error
}

async function savedItems(assetId: string) {
  const { data, error } = await service
    .from("media_label_items")
    .select("item_id, variant_id, added_by")
    .eq("asset_id", assetId)
  if (error) throw error
  return data
}

function readyLabels(done: Outcome<FinaliseResponse>) {
  expect(done.ok).toBe(true)
  if (!done.ok || done.state !== "ready") throw new Error("not ready")
  return done.labels
}

beforeAll(async () => {
  venueA = (await createVenue(service, "pending-labels-a")).id
  admin = await createIdentity(service, {
    label: "pending-labels-admin",
    role: "admin",
  })
  staffA = await createIdentity(service, {
    label: "pending-labels-a",
    role: "staff",
    venueId: venueA,
  })
  staffA2 = await createIdentity(service, {
    label: "pending-labels-a2",
    role: "staff",
    venueId: venueA,
  })
  actorA = await actorFor(staffA)
  actorA2 = await actorFor(staffA2)
  v1 = await publishMenu(
    admin,
    venueA,
    menu("Pending labels", [
      section("starters", "Starters", [
        item("bhaji", "Onion Bhaji", { variants: ["Small", "Large"] }),
        item("samosa", "Samosa"),
      ]),
    ])
  )
  rows = (await readDocument(service, v1)).byKey
}, 120_000)

describe("POST /api/upload-labels before the photo is ready", () => {
  it("stores the labels while uploading; finalise applies them as the uploader", async () => {
    const a = await upload(actorA, staffA)
    const first = await post(
      actorA,
      venueA,
      input(a.assetId, { items: [ref(rows.samosa)] })
    )
    expect(first).toEqual({
      status: 200,
      body: { ok: true, assetId: a.assetId, state: "pending" },
    })
    // A repeat replaces the stored input.
    const second = await post(actorA, venueA, input(a.assetId))
    expect(second.body).toEqual({
      ok: true,
      assetId: a.assetId,
      state: "pending",
    })

    const listed = await attention(actorA)
    const mine = listed.find((i) => i.assetId === a.assetId)
    expect(mine).toMatchObject({
      assetId: a.assetId,
      venueId: venueA,
      status: "pending",
      code: null,
      message: null,
      uploadState: "uploading",
      retryable: false,
      mediaType: "image",
      thumbnailUrl: null,
    })
    expect(mine!.input.items).toEqual([ref(rows.bhaji)])

    const labels = readyLabels(await finalise(actorA, a))
    expect(labels?.state).toBe("saved")
    if (labels?.state !== "saved") return
    expect(labels.labels.revision).toBe(1)
    expect(labels.labels.contentTypes).toEqual(["dish"])
    // "Not specified": the dish without a variant.
    expect(labels.labels.items).toMatchObject([
      { itemId: rows.bhaji.itemId, variantId: null, name: "Onion Bhaji" },
    ])

    expect(await savedItems(a.assetId)).toEqual([
      { item_id: rows.bhaji.itemId, variant_id: null, added_by: staffA.id },
    ])
    const { data: events } = await service
      .from("media_label_events")
      .select("actor_id, actor_role")
      .eq("asset_id", a.assetId)
    expect(events).toEqual([{ actor_id: staffA.id, actor_role: "staff" }])
    expect(await draftRow(a.assetId)).toBeNull()
    expect((await attention(actorA)).some((i) => i.assetId === a.assetId)).toBe(
      false
    )

    // Finalise again: already ready, nothing stored, no labels field.
    expect(await finalise(actorA, a)).toEqual({ ok: true, state: "ready" })
  })

  it("stores the labels while processing (bytes stored, finalise not yet run)", async () => {
    const a = await upload(actorA, staffA)
    await service
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", a.assetId)
    expect((await post(actorA, venueA, input(a.assetId))).body).toMatchObject({
      state: "pending",
    })
    await service
      .from("media_assets")
      .update({ upload_state: "failed" })
      .eq("id", a.assetId)
    // The transient failure keeps the draft; the retried finalise applies it.
    expect(await draftRow(a.assetId)).toMatchObject({ status: "pending" })
    expect(readyLabels(await finalise(actorA, a))?.state).toBe("saved")
  })

  it("saves at once when the photo is already ready", async () => {
    const a = await upload(actorA, staffA)
    expect(await finalise(actorA, a)).toEqual({ ok: true, state: "ready" })
    const saved = await post(actorA, venueA, input(a.assetId))
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({
      ok: true,
      assetId: a.assetId,
      state: "saved",
      labels: { revision: 1, hasLabels: true },
    })
    expect(await draftRow(a.assetId)).toBeNull()
    // A stale revision is the usual conflict, with what is saved now.
    const stale = await post(actorA, venueA, input(a.assetId))
    expect(stale.status).toBe(200)
    expect(stale.body).toMatchObject({ ok: false, code: "conflict" })
  })

  it("keeps the photo and marks the labels needs_attention when the menu changed (catalogue_changed)", async () => {
    const a = await upload(actorA, staffA)
    expect((await post(actorA, venueA, input(a.assetId))).body).toMatchObject({
      state: "pending",
    })
    // The manager publishes a new menu before the upload finishes.
    const v2 = await publishMenu(
      admin,
      venueA,
      menu("Pending labels 2", [
        section("starters", "Starters", [
          item("bhaji", "Onion Bhaji", {
            itemId: rows.bhaji.itemId,
            variants: rows.bhaji.variants,
          }),
        ]),
      ]),
      v1
    )

    const labels = readyLabels(await finalise(actorA, a))
    expect(labels).toEqual({
      state: "needs_attention",
      code: "catalogue_changed",
      message: expect.stringContaining("menu changed"),
    })
    const { data: asset } = await service
      .from("media_assets")
      .select("upload_state")
      .eq("id", a.assetId)
      .single()
    expect(asset?.upload_state).toBe("ready")
    expect(await savedItems(a.assetId)).toEqual([])

    const listed = (await attention(actorA)).find(
      (i) => i.assetId === a.assetId
    )
    expect(listed).toMatchObject({
      status: "needs_attention",
      code: "catalogue_changed",
      uploadState: "ready",
      retryable: false,
    })
    expect(listed!.thumbnailUrl).toBe(`/api/media/${a.assetId}/thumb`)
    // An already-ready finalise reports the open problem again.
    expect(readyLabels(await finalise(actorA, a))).toMatchObject({
      state: "needs_attention",
      code: "catalogue_changed",
    })

    // "Fix labels": the corrected input against the current menu saves now
    // and clears the problem.
    const fixed = await post(
      actorA,
      venueA,
      input(a.assetId, { catalogueVersionId: v2 })
    )
    expect(fixed.body).toMatchObject({ ok: true, state: "saved" })
    expect(await draftRow(a.assetId)).toBeNull()
    expect((await attention(actorA)).some((i) => i.assetId === a.assetId)).toBe(
      false
    )

    // Later tests label against the menu now active.
    v1 = v2
    rows = (await readDocument(service, v2)).byKey
  })

  it("marks a draft that fails validation needs_attention (invalid) and never blocks the photo", async () => {
    const a = await upload(actorA, staffA)
    expect((await post(actorA, venueA, input(a.assetId))).body).toMatchObject({
      state: "pending",
    })
    // A stored input the database refuses (as if tampered with after the POST).
    await service
      .from("media_pending_labels")
      .update({
        input: { ...input(a.assetId), expectedRevision: -1 } as never,
      })
      .eq("asset_id", a.assetId)
    expect(readyLabels(await finalise(actorA, a))).toMatchObject({
      state: "needs_attention",
      code: "invalid",
    })
  })

  it("discards a draft on DELETE (idempotent); the upload carries on", async () => {
    const a = await upload(actorA, staffA)
    await post(actorA, venueA, input(a.assetId))
    expect(await discard(actorA, a.assetId)).toEqual({
      status: 200,
      body: { ok: true, state: "discarded" },
    })
    expect(await discard(actorA, a.assetId)).toEqual({
      status: 200,
      body: { ok: true, state: "none" },
    })
    expect(await draftRow(a.assetId)).toBeNull()
    expect(await finalise(actorA, a)).toEqual({ ok: true, state: "ready" })
    expect(await savedItems(a.assetId)).toEqual([])
    // Ready, nothing stored, no labels: still nothing discarded or applied.
    expect((await discard(actorA, a.assetId)).body).toEqual({
      ok: true,
      state: "none",
    })
    expect((await discard(actorA, "not-a-uuid")).status).toBe(400)
  })

  it("a discard that lost the race with finalise says the labels were already applied (m2)", async () => {
    const a = await upload(actorA, staffA)
    expect((await post(actorA, venueA, input(a.assetId))).body).toMatchObject({
      state: "pending",
    })
    // The Retry's finalise applies the labels before Me's Discard arrives.
    expect(readyLabels(await finalise(actorA, a))?.state).toBe("saved")
    const late = await discard(actorA, a.assetId)
    expect(late.status).toBe(200)
    expect(late.body).toMatchObject({
      ok: true,
      state: "already_applied",
      labels: {
        revision: 1,
        hasLabels: true,
        items: [{ itemId: rows.bhaji.itemId, variantId: null }],
      },
    })
    // Nothing was discarded: the labels stay on the photo.
    expect(await savedItems(a.assetId)).toHaveLength(1)
  })

  it("stores labels for a temporarily failed upload, lists them as retryable, and the Retry applies them (m1, M3)", async () => {
    const a = await upload(actorA, staffA)
    // Storage, archive or decoder trouble: failed, bytes kept, retryable.
    await failTemporarily(a.assetId)
    const posted = await post(actorA, venueA, input(a.assetId))
    expect(posted).toEqual({
      status: 200,
      body: { ok: true, assetId: a.assetId, state: "pending" },
    })
    expect(await draftRow(a.assetId)).toMatchObject({ status: "pending" })
    expect(
      (await attention(actorA)).find((i) => i.assetId === a.assetId)
    ).toMatchObject({
      status: "pending",
      uploadState: "failed",
      retryable: true,
    })

    // Retry: finalise runs again, makes the photo ready and applies them.
    expect(readyLabels(await finalise(actorA, a))?.state).toBe("saved")
    expect(await savedItems(a.assetId)).toEqual([
      { item_id: rows.bhaji.itemId, variant_id: null, added_by: staffA.id },
    ])
    expect(await draftRow(a.assetId)).toBeNull()
  })

  it("refuses failed-for-good, unknown and other-venue assets as not_found", async () => {
    // Failed with no original stored: finalise can never make it ready.
    const failed = await upload(actorA, staffA, false)
    await failTemporarily(failed.assetId)
    const other = await createVenue(service, "pending-labels-other")
    for (const [assetId, venueId] of [
      [failed.assetId, venueA],
      [crypto.randomUUID(), venueA],
      [(await upload(actorA, staffA)).assetId, other.id],
    ]) {
      const res = await post(actorA, venueId, input(assetId))
      expect(res.status).toBe(404)
      expect(res.body).toMatchObject({ ok: false, assetId, code: "not_found" })
      expect(await draftRow(assetId)).toBeNull()
    }
  })

  it("removes the draft of a file that can never be used (validation failure)", async () => {
    const key = newKey()
    const reserved = await reserveAsset(actorA, {
      idempotencyKey: key,
      filename: "dish.jpg",
      sizeBytes: 64,
      contentType: "image/jpeg",
      mediaType: "image",
      preferResumable: false,
    })
    if (!reserved.ok) throw new Error(reserved.message)
    const junk = new Uint8Array(64).fill(7)
    const { error } = await staffA.client.storage
      .from("media")
      .uploadToSignedUrl(reserved.objectKey, reserved.token!, junk)
    expect(error).toBeNull()
    await post(actorA, venueA, input(reserved.assetId))
    expect(await draftRow(reserved.assetId)).toMatchObject({
      status: "pending",
    })
    const done = await finalise(actorA, { assetId: reserved.assetId, key })
    expect(done).toMatchObject({ ok: true, state: "failed" })
    expect(await draftRow(reserved.assetId)).toBeNull()
    // Its original is gone: later labels are refused, never kept for a Retry.
    const late = await post(actorA, venueA, input(reserved.assetId))
    expect(late.status).toBe(404)
    expect(late.body).toMatchObject({ ok: false, code: "not_found" })
    expect(await draftRow(reserved.assetId)).toBeNull()
  })
})

describe("row 9: staff own-only stored drafts (server layer)", () => {
  it("another staff member at the same venue cannot read, apply, replace or discard A's draft", async () => {
    const a = await upload(actorA, staffA)
    await post(actorA, venueA, input(a.assetId))

    // Not listed for A2.
    expect(
      (await attention(actorA2)).some((i) => i.assetId === a.assetId)
    ).toBe(false)
    // A2's POST with A's asset id looks like an unknown asset and changes nothing.
    const forged = await post(actorA2, venueA, input(a.assetId, { items: [] }))
    expect(forged.status).toBe(404)
    expect(forged.body).toMatchObject({ code: "not_found" })
    // A2's DELETE succeeds (idempotent) but A's draft stays.
    expect((await discard(actorA2, a.assetId)).body).toEqual({
      ok: true,
      state: "none",
    })
    expect(await draftRow(a.assetId)).toMatchObject({
      status: "pending",
      uploader_id: staffA.id,
    })
    // A2's finalise of A's asset is refused; A's finalise applies A's draft.
    expect(await finalise(actorA2, a)).toMatchObject({ ok: false, status: 404 })
    expect(readyLabels(await finalise(actorA, a))?.state).toBe("saved")
    expect(await savedItems(a.assetId)).toEqual([
      { item_id: rows.bhaji.itemId, variant_id: null, added_by: staffA.id },
    ])
  })
})

describe("drafts follow the asset", () => {
  it("removal takes the draft with the asset", async () => {
    const a = await upload(actorA, staffA)
    await post(actorA, venueA, input(a.assetId))
    const removed = await removeMediaAssetWith(
      { user: staffA.client, service },
      a.assetId
    )
    expect(removed.ok).toBe(true)
    expect(await draftRow(a.assetId)).toBeNull()
  })

  it("the 24 h abandoned-upload cleanup takes the draft with the asset", async () => {
    // Reserved, labelled, never transferred: the browser went away.
    const a = await upload(actorA, staffA, false)
    await post(actorA, venueA, input(a.assetId))
    const early = await runMediaCleanup(service, {
      now: new Date(Date.now() + 1 * HOUR),
    })
    expect(early.status).toBe("completed")
    expect(await draftRow(a.assetId)).toMatchObject({ status: "pending" })

    const late = await runMediaCleanup(service, {
      now: new Date(Date.now() + 25 * HOUR),
    })
    expect(late.status).toBe("completed")
    const { data } = await service
      .from("media_assets")
      .select("deleted_at")
      .eq("id", a.assetId)
      .single()
    expect(data?.deleted_at).not.toBeNull()
    expect(await draftRow(a.assetId)).toBeNull()
  })
})

describe("POST racing finalise", () => {
  it("a POST committed just before the ready transaction is applied by finalise", async () => {
    const a = await upload(actorA, staffA)
    let before: (() => Promise<void>) | null = async () => {
      expect((await post(actorA, venueA, input(a.assetId))).body).toMatchObject(
        {
          state: "pending",
        }
      )
    }
    const actor = {
      ...actorA,
      service: interceptedService(async (url) => {
        if (before && url.includes("/rpc/complete_media_finalise")) {
          const run = before
          before = null
          await run()
        }
      }),
    }
    expect(readyLabels(await finalise(actor, a))?.state).toBe("saved")
    expect(before).toBeNull()
    expect(await savedItems(a.assetId)).toHaveLength(1)
    expect(await draftRow(a.assetId)).toBeNull()
  })

  it("a POST right after the ready transaction saves directly", async () => {
    const a = await upload(actorA, staffA)
    let posted: UploadLabelPostResult | null = null
    const actor = {
      ...actorA,
      service: interceptedService(undefined, async (url) => {
        if (!posted && url.includes("/rpc/complete_media_finalise")) {
          posted = (await post(actorA, venueA, input(a.assetId))).body
        }
      }),
    }
    // No draft existed when the asset became ready: no labels field.
    expect(await finalise(actor, a)).toEqual({ ok: true, state: "ready" })
    expect(posted).toMatchObject({ ok: true, state: "saved" })
    expect(await savedItems(a.assetId)).toHaveLength(1)
    expect(await draftRow(a.assetId)).toBeNull()
  })

  it(
    "never loses labels when POST and finalise run concurrently",
    { timeout: 120_000 },
    async () => {
      for (let round = 0; round < 8; round++) {
        const a = await upload(actorA, staffA)
        const delay = (round % 4) * 15
        const [done, posted] = await Promise.all([
          finalise(actorA, a),
          new Promise((r) => setTimeout(r, delay)).then(() =>
            post(actorA, venueA, input(a.assetId))
          ),
        ])
        expect(done.ok, `round ${round}`).toBe(true)
        expect(posted.body.ok, `round ${round}`).toBe(true)
        // Whichever came first, the labels are on the asset and no draft is left.
        expect(await savedItems(a.assetId), `round ${round}`).toEqual([
          { item_id: rows.bhaji.itemId, variant_id: null, added_by: staffA.id },
        ])
        expect(await draftRow(a.assetId), `round ${round}`).toBeNull()
        if (posted.body.ok && posted.body.state === "pending") {
          // Applied by finalise: it reported them.
          expect(readyLabels(done)?.state, `round ${round}`).toBe("saved")
        }
      }
    }
  )
})

describe("who settles stored labels (m17)", () => {
  it("an admin's save leaves the uploader's needs_attention labels; the uploader's own save settles them", async () => {
    const a = await upload(actorA, staffA)
    await post(actorA, venueA, input(a.assetId))
    // A stored input the database refuses: needs_attention once ready.
    await service
      .from("media_pending_labels")
      .update({
        input: { ...input(a.assetId), expectedRevision: -1 } as never,
      })
      .eq("asset_id", a.assetId)
    expect(readyLabels(await finalise(actorA, a))).toMatchObject({
      state: "needs_attention",
    })

    // An admin labels the photo for an unrelated reason.
    const byAdmin = await admin.client.rpc("save_media_labels", {
      p_asset_id: a.assetId,
      p_expected_revision: 0,
      p_content_types: ["venue"],
      p_note: "",
      p_items: [],
      p_catalogue_version_id: v1,
    })
    expect(byAdmin.error).toBeNull()
    // The uploader's dish is still on their Me list, not silently gone.
    expect(await draftRow(a.assetId)).toMatchObject({
      status: "needs_attention",
      uploader_id: staffA.id,
    })
    expect(
      (await attention(actorA)).find((i) => i.assetId === a.assetId)
    ).toMatchObject({ status: "needs_attention", uploadState: "ready" })

    // "Fix labels" by the uploader saves and settles them.
    const fixed = await post(
      actorA,
      venueA,
      input(a.assetId, { expectedRevision: 1 })
    )
    expect(fixed.body).toMatchObject({ ok: true, state: "saved" })
    expect(await draftRow(a.assetId)).toBeNull()
  })
})

/** The LOCAL stack's database URL: stack.mjs env, else `supabase status`. */
function localDbUrl() {
  let url = process.env.SUPABASE_DB_URL
  if (!url) {
    const raw = execFileSync("supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    const status = JSON.parse(
      raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
    ) as { API_URL?: string; DB_URL?: string }
    // Never the database of another stack than the API under test.
    if (status.API_URL !== getLocalSupabaseEnv().url)
      throw new Error("Set SUPABASE_DB_URL for the stack under test")
    url = status.DB_URL
  }
  if (!url) throw new Error("Set SUPABASE_DB_URL for the local stack")
  const host = new URL(url).hostname
  if (host !== "127.0.0.1" && host !== "localhost")
    throw new Error(`Refusing to touch non-local database host ${host}`)
  return url
}

/** One statement as the database owner (psql). Values: test-made ids only. */
function sql(query: string) {
  return execFileSync(
    "psql",
    [localDbUrl(), "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", query],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim()
}

/**
 * `query` in a session of its own, in the background, as a concurrent
 * request would run it. `stop()` ends that session: killing psql alone would
 * leave its backend (and its locks) running until the query ends.
 */
function background(query: string) {
  const name = `labels-test-${crypto.randomUUID()}`
  const child = spawn("psql", [localDbUrl(), "-X", "-q", "-c", query], {
    stdio: "ignore",
    env: { ...process.env, PGAPPNAME: name },
  })
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", resolve)
  )
  return {
    exited,
    stop: async () => {
      sql(
        `select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${name}'`
      )
      await exited
    },
  }
}

async function until(check: () => boolean, what: string) {
  const deadline = Date.now() + 10_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

const UUID_ONLY = /^[0-9a-f-]{36}$/

describe("a lock wait during the label apply (n1)", () => {
  it(
    "never fails or stalls the finalise: the photo is ready and its labels need attention (unavailable)",
    { timeout: 60_000 },
    async () => {
      const a = await upload(actorA, staffA)
      await post(actorA, venueA, input(a.assetId))
      // The venue menu lock (private.lock_venue_menu), held exclusively as a
      // menu activation holds it.
      expect(venueA).toMatch(UUID_ONLY)
      const key = `hashtextextended('nabalens_menu:${venueA}', 0)`
      const free = () =>
        sql(`select pg_try_advisory_xact_lock_shared(${key})`) === "t"
      const holder = background(
        `select pg_advisory_lock(${key}); select pg_sleep(60)`
      )
      let done: Outcome<FinaliseResponse>
      let elapsed: number
      try {
        await until(() => !free(), "menu lock taken")
        const started = Date.now()
        done = await finalise(actorA, a)
        elapsed = Date.now() - started
      } finally {
        await holder.stop()
      }
      await until(free, "menu lock released")

      // Bounded by the apply's lock_timeout, not by the lock holder.
      expect(elapsed).toBeLessThan(15_000)
      expect(readyLabels(done)).toMatchObject({
        state: "needs_attention",
        code: "unavailable",
      })
      expect(await uploadState(a.assetId)).toBe("ready")
      expect(await savedItems(a.assetId)).toEqual([])
      expect(await draftRow(a.assetId)).toMatchObject({
        status: "needs_attention",
        code: "unavailable",
      })

      // Once the lock is free, "Fix labels" saves them.
      const fixed = await post(actorA, venueA, input(a.assetId))
      expect(fixed.body).toMatchObject({ ok: true, state: "saved" })
      expect(await draftRow(a.assetId)).toBeNull()
    }
  )
})

describe("a file that can never be used, racing a label POST", () => {
  it(
    "labels being stored as finalise gives up on the file are discarded with it",
    { timeout: 60_000 },
    async () => {
      const key = newKey()
      const reserved = await reserveAsset(actorA, {
        idempotencyKey: key,
        filename: "dish.jpg",
        sizeBytes: 64,
        contentType: "image/jpeg",
        mediaType: "image",
        preferResumable: false,
      })
      if (!reserved.ok) throw new Error(reserved.message)
      const { error } = await staffA.client.storage
        .from("media")
        .uploadToSignedUrl(
          reserved.objectKey,
          reserved.token!,
          new Uint8Array(64).fill(7)
        )
      expect(error).toBeNull()
      const id = reserved.assetId
      for (const value of [id, staffA.id, venueA])
        expect(value).toMatch(UUID_ONLY)
      const locked = () =>
        sql(
          `select count(*) from (select 1 from public.media_assets where id = '${id}' for update skip locked) s`
        ) === "0"

      // A stage_media_labels that saw the original just before finalise
      // removed it: it holds the asset row lock and its labels are not
      // committed yet when finalise discards the file's labels.
      let stage: ReturnType<typeof background> | null = null
      const actor = {
        ...actorA,
        service: interceptedService(async (url) => {
          if (
            !stage &&
            (url.includes("/rpc/discard_unusable_media_labels") ||
              url.includes("/media_pending_labels"))
          ) {
            stage = background(
              `begin;
               select 1 from public.media_assets where id = '${id}' for update;
               insert into public.media_pending_labels (asset_id, uploader_id, venue_id, input)
               values ('${id}', '${staffA.id}', '${venueA}', '${JSON.stringify(input(id))}'::jsonb);
               select pg_sleep(2);
               commit;`
            )
            await until(locked, "asset row locked")
          }
        }),
      }
      const done = await finalise(actor, { assetId: id, key })
      expect(done).toMatchObject({ ok: true, state: "failed" })
      expect(stage).not.toBeNull()
      expect(await stage!.exited).toBe(0)
      // Not left behind for a file whose Retry can never apply it.
      expect(await draftRow(id)).toBeNull()
    }
  )
})
