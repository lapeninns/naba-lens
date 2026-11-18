// Full App v1 S1-UPLOAD (20261118102000_upload_pipeline.sql): the batch ID
// and limits on reserve_media_asset, the current-venue recheck in storage and
// complete_media_finalise (AC12), the content hash and same-venue duplicate
// link (AC21, AC23), capture time and its correction (set_media_captured_at),
// renditions, and duplicates left out of monthly credit. Real signed-in
// identities through PostgREST and the app's own finalise; the service role
// and psql only build fixtures and read state back.
import { createHash, randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { finaliseAsset } from "../../lib/server/media/finalise"
import { actorFor, syntheticJpeg } from "../slice/media-actor"
import {
  anonClient,
  createIdentity,
  markReady,
  type TestIdentity,
} from "../support/identities"
import {
  currentMonth,
  insertAsset,
  insertSubmittedItem,
  itemRevision,
  ok,
  psql,
  review,
} from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  call,
  refused,
  service,
  world,
  type World,
} from "./knowledge-fixtures"

type Reserved = {
  id: string
  original_path: string
  venue_id: string
  upload_state: string
  reused: boolean
}

const MiB = 1024 * 1024

const reservation = (
  opts: {
    key?: string
    batch?: string
    size?: number
    mediaType?: "image" | "video"
  } = {}
) => {
  const mediaType = opts.mediaType ?? "image"
  return {
    p_media_type: mediaType,
    p_extension: mediaType === "image" ? "jpg" : "mp4",
    p_original_filename: `TEST pipeline.${mediaType === "image" ? "jpg" : "mp4"}`,
    p_size_bytes: opts.size ?? 4,
    p_client_upload_key: opts.key ?? randomUUID(),
    ...(opts.batch !== undefined ? { p_client_batch_id: opts.batch } : {}),
  }
}

async function reserve(
  who: TestIdentity,
  opts: Parameters<typeof reservation>[0] = {}
): Promise<Reserved> {
  const { data, error } = await call(
    who,
    "reserve_media_asset",
    reservation(opts)
  )
  if (error) throw new Error(`${error.message} (${error.code})`)
  return (data as Reserved[])[0]!
}

const column = (id: string, name: string) =>
  psql(
    `select coalesce(${name}::text, 'null') from public.media_assets where id = '${id}'`
  )

/** Reserve, store real bytes as the uploader, and keep the key. */
async function stored(
  who: TestIdentity,
  bytes?: Uint8Array,
  batch?: string
): Promise<{ id: string; key: string; path: string; bytes: Uint8Array }> {
  const body = bytes ?? (await syntheticJpeg(1800, 1200))
  const key = randomUUID()
  const r = await reserve(who, { key, size: body.byteLength, batch })
  const signed = await who.client.storage
    .from("media")
    .createSignedUploadUrl(r.original_path)
  if (signed.error) throw signed.error
  const put = await who.client.storage
    .from("media")
    .uploadToSignedUrl(r.original_path, signed.data.token, body, {
      contentType: "image/jpeg",
    })
  if (put.error) throw put.error
  return { id: r.id, key, path: r.original_path, bytes: body }
}

async function finalise(who: TestIdentity, id: string, key: string) {
  return finaliseAsset(await actorFor(who), {
    assetId: id,
    idempotencyKey: key,
  })
}

/** complete_media_finalise as the service role, on a processing asset. */
async function complete(
  id: string,
  extra: { sha?: string; capturedAt?: string } = {}
) {
  await ok(
    service
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", id)
  )
  return service.rpc("complete_media_finalise", {
    p_asset_id: id,
    p_validated_mime_type: "image/jpeg",
    p_size_bytes: 4,
    ...(extra.sha ? { p_content_sha256: extra.sha } : {}),
    ...(extra.capturedAt ? { p_captured_at: extra.capturedAt } : {}),
  })
}

const sha = (seed: string) => createHash("sha256").update(seed).digest("hex")

async function moveTo(who: TestIdentity, venueId: string) {
  await ok(
    service.from("profiles").update({ venue_id: venueId }).eq("id", who.id)
  )
}

let v: World
let other: World
let mover: TestIdentity
let leaver: TestIdentity

beforeAll(async () => {
  await knowledgeAdmin()
  ;[v, other] = await Promise.all([world("upl-a"), world("upl-b")])
  ;[mover, leaver] = await Promise.all([
    createIdentity(service, {
      label: "upl-mover",
      role: "staff",
      venueId: v.venue,
    }),
    createIdentity(service, {
      label: "upl-leaver",
      role: "staff",
      venueId: v.venue,
    }),
  ])
})

describe("reserve_media_asset", () => {
  it("stores the batch ID with the first reservation and keeps it on retry", async () => {
    const key = randomUUID()
    const batch = `batch-${randomUUID()}`
    const first = await reserve(v.staffA, { key, batch })
    expect(column(first.id, "client_batch_id")).toBe(batch)
    // A retry of the same file, even naming another batch, keeps the first.
    const again = await reserve(v.staffA, {
      key,
      batch: `batch-${randomUUID()}`,
    })
    expect(again).toMatchObject({ id: first.id, reused: true })
    expect(column(first.id, "client_batch_id")).toBe(batch)
    // No batch is fine (older clients).
    const none = await reserve(v.staffA)
    expect(column(none.id, "client_batch_id")).toBe("null")
  })

  it("refuses a malformed batch ID", async () => {
    await refused(
      v.staffA,
      "reserve_media_asset",
      reservation({ batch: "x y" }),
      "invalid_batch_id",
      "22023"
    )
    await refused(
      v.staffA,
      "reserve_media_asset",
      reservation({ batch: "short" }),
      "invalid_batch_id",
      "22023"
    )
  })

  it("takes photos up to 25 MiB and videos up to 250 MiB, and no more", async () => {
    await reserve(v.staffB, { size: 25 * MiB })
    await refused(
      v.staffB,
      "reserve_media_asset",
      reservation({ size: 25 * MiB + 1 }),
      "invalid_size",
      "22023"
    )
    await reserve(v.staffB, { size: 250 * MiB, mediaType: "video" })
    await refused(
      v.staffB,
      "reserve_media_asset",
      reservation({ size: 250 * MiB + 1, mediaType: "video" }),
      "invalid_size",
      "22023"
    )
  })

  it("is staff and manager only, admins naming a venue (S2-INT); anon cannot reserve", async () => {
    await refused(
      v.admin,
      "reserve_media_asset",
      reservation(),
      "venue_required",
      "22023"
    )
    const { error } = await anonClient().rpc(
      "reserve_media_asset",
      reservation()
    )
    expect(error).not.toBeNull()
    // A manager account still reserves at its managed venue, with the batch.
    const batch = `batch-${randomUUID()}`
    const m = await reserve(v.manager, { batch })
    expect(m.venue_id).toBe(v.venue)
    expect(column(m.id, "client_batch_id")).toBe(batch)
  })

  it("still lets the media bucket hold a 250 MiB original", () => {
    expect(
      psql(`select file_size_limit from storage.buckets where id = 'media'`)
    ).toBe(String(250 * MiB))
  })
})

describe("finalise through the app", () => {
  it("reads an offsetless photo capture time in the upload venue's timezone", async () => {
    const local = await world("capture-time-zone")
    await ok(
      service
        .from("venues")
        .update({ timezone: "America/New_York" })
        .eq("id", local.venue)
    )
    const bytes = await syntheticJpeg(320, 240, "2026:07:10 12:00:00")
    const upload = await stored(local.staffA, bytes)
    expect(await finalise(local.staffA, upload.id, upload.key)).toMatchObject({
      ok: true,
      state: "ready",
    })
    expect(column(upload.id, "captured_at_source")).toBe("metadata")
    expect(
      psql(`select captured_at = '2026-07-10T16:00:00Z'
      from public.media_assets where id = '${upload.id}'`)
    ).toBe("t")
  })

  it("records the hash, renditions and an unknown capture time", async () => {
    const batch = `batch-${randomUUID()}`
    const up = await stored(v.staffA, undefined, batch)
    const done = await finalise(v.staffA, up.id, up.key)
    expect(done).toMatchObject({ ok: true, state: "ready" })
    expect(done).not.toHaveProperty("duplicate")
    expect(column(up.id, "content_sha256")).toBe(
      createHash("sha256").update(up.bytes).digest("hex")
    )
    expect(column(up.id, "duplicate_of_asset_id")).toBe("null")
    // A synthetic JPEG has no EXIF: unknown, not the upload time.
    expect(column(up.id, "captured_at_source")).toBe("unknown")
    expect(column(up.id, "captured_at")).toBe("null")
    expect(column(up.id, "client_batch_id")).toBe(batch)
    const renditions = psql(
      `select string_agg(kind || ':' || width || 'x' || height || ':' || mime_type || ':' || pipeline_version, ',' order by kind)
       from public.media_renditions where asset_id = '${up.id}'`
    )
    expect(renditions).toMatch(
      /^preview:1600x1067:image\/webp:img-[\d-]+,thumbnail:480x320:image\/webp:img-[\d-]+$/
    )
  })

  it("marks an exact copy at the same venue as a duplicate, not one at another venue", async () => {
    const original = await stored(v.staffA)
    await finalise(v.staffA, original.id, original.key)
    // The same bytes again, from a colleague at the same venue.
    const copy = await stored(v.staffB, original.bytes)
    expect(await finalise(v.staffB, copy.id, copy.key)).toMatchObject({
      ok: true,
      state: "ready",
      duplicate: true,
    })
    expect(column(copy.id, "duplicate_of_asset_id")).toBe(original.id)
    // The same bytes at another venue: never compared (AC23).
    const elsewhere = await stored(other.staffA, original.bytes)
    const result = await finalise(other.staffA, elsewhere.id, elsewhere.key)
    expect(result).toMatchObject({ ok: true, state: "ready" })
    expect(result).not.toHaveProperty("duplicate")
    expect(column(elsewhere.id, "duplicate_of_asset_id")).toBe("null")
    // The copy's uploader cannot read the venue-A link from venue B.
    const read = await ok(
      other.staffA.client
        .from("media_assets")
        .select("id")
        .eq("id", original.id)
    )
    expect(read).toEqual([])
  })

  it("refuses to finish an upload after the uploader moved venue (AC12)", async () => {
    const up = await stored(mover)
    await moveTo(mover, other.venue)
    try {
      expect(await finalise(mover, up.id, up.key)).toMatchObject({
        ok: false,
        status: 403,
      })
      expect(column(up.id, "upload_state")).not.toBe("ready")
      // The bytes stay private: colleagues at either venue see no row.
      for (const who of [v.staffA, v.manager, other.staffA]) {
        const rows = await ok(
          who.client.from("media_assets").select("id").eq("id", up.id)
        )
        expect(rows).toEqual([])
      }
    } finally {
      await moveTo(mover, v.venue)
    }
    // Back at the venue it may finish (a retry, nothing sent twice).
    expect(await finalise(mover, up.id, up.key)).toMatchObject({
      ok: true,
      state: "ready",
    })
  })
})

describe("storage writes recheck the current venue", () => {
  it("refuses a staff member's write for the old venue after a move", async () => {
    const r = await reserve(mover, { size: 4 })
    const issued = await mover.client.storage
      .from("media")
      .createSignedUploadUrl(r.original_path)
    expect(issued.error).toBeNull()
    await moveTo(mover, other.venue)
    try {
      const put = await mover.client.storage
        .from("media")
        .uploadToSignedUrl(
          r.original_path,
          issued.data!.token,
          new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
          { contentType: "image/jpeg" }
        )
      expect(put.error).not.toBeNull()
      const mint = await mover.client.storage
        .from("media")
        .createSignedUploadUrl(r.original_path)
      expect(mint.error).not.toBeNull()
      const { data } = await service.storage
        .from("media")
        .download(r.original_path)
      expect(data).toBeNull()
    } finally {
      await moveTo(mover, v.venue)
    }
  })
})

describe("complete_media_finalise", () => {
  it("is the service role's alone", async () => {
    const r = await reserve(v.staffA)
    for (const who of [v.staffA, v.manager, v.admin]) {
      const { error } = await who.client.rpc("complete_media_finalise", {
        p_asset_id: r.id,
        p_validated_mime_type: "image/jpeg",
        p_size_bytes: 4,
      })
      expect(error).not.toBeNull()
    }
    const { error } = await anonClient().rpc("complete_media_finalise", {
      p_asset_id: r.id,
      p_validated_mime_type: "image/jpeg",
      p_size_bytes: 4,
    })
    expect(error).not.toBeNull()
    expect(column(r.id, "upload_state")).toBe("uploading")
  })

  it("refuses an inactive uploader, and one whose venue closed", async () => {
    const r = await reserve(leaver)
    await ok(
      service.from("profiles").update({ active: false }).eq("id", leaver.id)
    )
    const { error } = await complete(r.id, { sha: sha("leaver") })
    expect(error?.message).toBe("upload_access_ended")
    expect(column(r.id, "upload_state")).toBe("processing")
    expect(column(r.id, "content_sha256")).toBe("null")

    const closing = await createIdentity(service, {
      label: "upl-closing",
      role: "staff",
      venueId: other.venue,
    })
    const c = await reserve(closing)
    await ok(
      service.from("venues").update({ active: false }).eq("id", other.venue)
    )
    try {
      const { error: closed } = await complete(c.id)
      expect(closed?.message).toBe("upload_access_ended")
    } finally {
      await ok(
        service.from("venues").update({ active: true }).eq("id", other.venue)
      )
    }
  })

  it("refuses a manager account's upload after its grant ended", async () => {
    const mgr = await reserve(other.manager)
    const { data: grant } = await service
      .from("venue_manager_grants")
      .select("id")
      .eq("staff_id", other.manager.id)
      .is("revoked_at", null)
      .single()
    await ok(
      other.admin.client.rpc("revoke_venue_manager", {
        p_grant_id: grant!.id,
        p_reason: "TEST grant ended",
      })
    )
    const { error } = await complete(mgr.id)
    expect(error?.message).toBe("upload_access_ended")
  })

  it("stores the capture time from the file, and keeps one a person supplied", async () => {
    const a = await reserve(v.staffA)
    const { data } = await complete(a.id, {
      capturedAt: "2026-07-14T18:30:05Z",
    })
    expect(data?.[0]).toMatchObject({ became_ready: true })
    expect(column(a.id, "captured_at_source")).toBe("metadata")
    expect(
      psql(
        `select captured_at = '2026-07-14T18:30:05Z' from public.media_assets where id = '${a.id}'`
      )
    ).toBe("t")

    const b = await reserve(v.staffA)
    await ok(
      call(v.staffA, "set_media_captured_at", {
        p_asset_id: b.id,
        p_captured_at: "2026-06-01T12:00:00Z",
      })
    )
    await complete(b.id, { capturedAt: "2026-07-14T18:30:05Z" })
    expect(column(b.id, "captured_at_source")).toBe("supplied")
    expect(
      psql(
        `select captured_at = '2026-06-01T12:00:00Z' from public.media_assets where id = '${b.id}'`
      )
    ).toBe("t")
  })

  it("refuses a malformed hash, and never moves a hash once set", async () => {
    const r = await reserve(v.staffA)
    const { error } = await complete(r.id, { sha: "not-a-hash" })
    expect(error?.message).toBe("invalid_content_hash")
    await complete(r.id, { sha: sha("fixed") })
    const { error: moved } = await service
      .from("media_assets")
      .update({ content_sha256: sha("other") })
      .eq("id", r.id)
    expect(moved?.message).toBe("media_asset_pipeline_immutable")
    const { error: linked } = await service
      .from("media_assets")
      .update({ duplicate_of_asset_id: randomUUID() })
      .eq("id", r.id)
    expect(linked?.message).toBe("media_asset_pipeline_immutable")
  })

  it("links only a live ready asset with the same hash at the same venue", async () => {
    const hash = sha(`dup-${randomUUID()}`)
    const first = await reserve(v.staffA)
    await complete(first.id, { sha: hash })
    const second = await reserve(v.staffB)
    const { data } = await complete(second.id, { sha: hash })
    expect(data?.[0]?.duplicate_of_asset_id).toBe(first.id)
    await ok(
      service
        .from("media_assets")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", first.id)
    )
    const third = await reserve(v.staffA)
    const { data: after } = await complete(third.id, { sha: hash })
    // The earliest live one is now the second upload.
    expect(after?.[0]?.duplicate_of_asset_id).toBe(second.id)
  })
})

describe("set_media_captured_at", () => {
  let asset: string
  beforeAll(async () => {
    asset = (await reserve(v.staffA)).id
    await markReady(service, asset)
  })

  const setAs = (who: TestIdentity, at: string | null, id = asset) =>
    call(who, "set_media_captured_at", {
      p_asset_id: id,
      p_captured_at: at,
    })

  it("lets the uploader supply or clear it", async () => {
    expect(await ok(setAs(v.staffA, "2026-05-01T09:00:00Z"))).toMatchObject({
      assetId: asset,
      capturedAtSource: "supplied",
    })
    expect(column(asset, "captured_at_set_by")).toBe(v.staffA.id)
    expect(await ok(setAs(v.staffA, null))).toMatchObject({
      capturedAt: null,
      capturedAtSource: "unknown",
    })
  })

  it("lets the venue's manager and an admin correct it", async () => {
    await ok(setAs(v.manager, "2026-05-02T09:00:00Z"))
    expect(column(asset, "captured_at_set_by")).toBe(v.manager.id)
    await ok(setAs(v.admin, "2026-05-03T09:00:00Z"))
    expect(column(asset, "captured_at_set_by")).toBe(v.admin.id)
  })

  it("is not found for a colleague, another venue's manager or staff", async () => {
    for (const who of [v.staffB, other.staffA, other.manager])
      await refused(
        who,
        "set_media_captured_at",
        { p_asset_id: asset, p_captured_at: "2026-05-04T09:00:00Z" },
        "media_asset_not_found",
        "P0002"
      )
    expect(column(asset, "captured_at_set_by")).toBe(v.admin.id)
  })

  it("refuses an inactive account, anon and impossible dates", async () => {
    const own = (await reserve(v.staffB)).id
    const inactive = await createIdentity(service, {
      label: "upl-inactive",
      role: "staff",
      venueId: v.venue,
      active: false,
    })
    await refused(
      inactive,
      "set_media_captured_at",
      { p_asset_id: own, p_captured_at: "2026-05-04T09:00:00Z" },
      "not_active_user",
      "42501"
    )
    const { error } = await anonClient().rpc("set_media_captured_at", {
      p_asset_id: own,
      p_captured_at: "2026-05-04T09:00:00Z",
    })
    expect(error).not.toBeNull()
    for (const at of ["2099-01-01T00:00:00Z", "1980-01-01T00:00:00Z"])
      await refused(
        v.staffB,
        "set_media_captured_at",
        { p_asset_id: own, p_captured_at: at },
        "invalid_captured_at",
        "22023"
      )
  })
})

describe("monthly credit", () => {
  it("does not credit an exact duplicate (AC21)", async () => {
    const now = new Date().toISOString()
    const hash = sha(`credit-${randomUUID()}`)
    const original = await insertAsset(service, {
      uploader: v.staffA.id,
      venue: v.venue,
      ready: false,
    })
    await ok(
      service
        .from("media_assets")
        .update({ content_sha256: hash })
        .eq("id", original.id)
    )
    await markReady(service, original.id)
    const copy = await insertAsset(service, {
      uploader: v.staffB.id,
      venue: v.venue,
      ready: false,
    })
    await ok(
      service
        .from("media_assets")
        .update({ content_sha256: hash, duplicate_of_asset_id: original.id })
        .eq("id", copy.id)
    )
    await markReady(service, copy.id)
    for (const [asset, author] of [
      [original, v.staffA.id],
      [copy, v.staffB.id],
    ] as const) {
      const item = await insertSubmittedItem(service, {
        asset,
        venue: v.venue,
        author,
        submittedAt: now,
      })
      const { revision } = await itemRevision(service, item)
      await ok(review(v.staffManager, item, revision, "accepted"))
    }
    const month = currentMonth()
    const ids = `('${original.id}', '${copy.id}')`
    expect(
      psql(
        `select count(*) from private.monthly_credit_items_base('${month}') where asset_id in ${ids}`
      )
    ).toBe("2")
    expect(
      psql(
        `select string_agg(asset_id::text, ',') from private.monthly_credit_items('${month}') where asset_id in ${ids}`
      )
    ).toBe(original.id)
  })
})
