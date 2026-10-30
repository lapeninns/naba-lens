// Wave 3 review findings 1, 4 and 5 (docs/reviews/wave3-review.md), proved as
// real signed-in users over the public APIs. The service role only arranges state
// (ready/processing/tombstone/deactivation) and reads back what was persisted.
import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  TINY_BYTES,
  type TestIdentity,
} from "../support/identities"
import type { Database } from "../../lib/db/types"
import { MEDIA_LIMITS } from "../../lib/config/media"
import { signDerivative } from "../../lib/server/media/access"
import { signAvatar } from "../../lib/server/media/profile"
import { actorFor } from "../slice/media-actor"
import { getLocalSupabaseEnv } from "../support/local-supabase"

const service = serviceClient()
const MiB = 1024 * 1024
/** Supabase's resumable endpoint takes 6 MiB chunks (lib/upload/tus.ts). */
const TUS_CHUNK = 6 * MiB

let venue: string
let staff: TestIdentity
let admin: TestIdentity

async function tokenOf(user: TestIdentity) {
  const { data } = await user.client.auth.getSession()
  return data.session!.access_token
}

async function reserve(
  user: TestIdentity,
  overrides: Record<string, unknown> = {}
) {
  const { data, error } = await user.client.rpc("reserve_media_asset", {
    // Required by reserve_media_asset (wave 3 finding 5 / upload-path F5).
    p_client_upload_key: crypto.randomUUID(),
    p_size_bytes: 4,
    p_media_type: "image",
    p_extension: "jpg",
    p_original_filename: "TEST hardening.jpg",
    ...overrides,
  })
  return { row: data?.[0], error }
}

async function reserveOk(user: TestIdentity) {
  const { row, error } = await reserve(user)
  if (error) throw error
  return row!
}

async function stored(key: string) {
  const { data, error } = await service.storage
    .from("media")
    .list(key.slice(0, key.lastIndexOf("/")))
  if (error) throw error
  return (data ?? []).some(
    (o) => o.name === key.slice(key.lastIndexOf("/") + 1)
  )
}

async function setRow(
  id: string,
  patch: Database["public"]["Tables"]["media_assets"]["Update"]
) {
  const { error } = await service
    .from("media_assets")
    .update(patch)
    .eq("id", id)
  if (error) throw error
}

async function setActive(user: TestIdentity, active: boolean) {
  const { error } = await service
    .from("profiles")
    .update({ active })
    .eq("id", user.id)
  if (error) throw error
}

/** Raw TUS against Storage, with the user's JWT (like lib/upload/tus.ts). */
async function tusCreate(token: string, key: string, length: number) {
  const env = getLocalSupabaseEnv()
  const b64 = (s: string) => Buffer.from(s).toString("base64")
  const res = await fetch(`${env.url}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      apikey: env.publishableKey,
      authorization: `Bearer ${token}`,
      "tus-resumable": "1.0.0",
      "upload-length": String(length),
      "x-upsert": "false",
      "upload-metadata": [
        `bucketName ${b64("media")}`,
        `objectName ${b64(key)}`,
        `contentType ${b64("image/jpeg")}`,
      ].join(","),
    },
    signal: AbortSignal.timeout(20_000),
  })
  await res.body?.cancel()
  return res
}

async function tusPatch(
  token: string,
  location: string,
  offset: number,
  body: Uint8Array
) {
  const env = getLocalSupabaseEnv()
  const res = await fetch(location, {
    method: "PATCH",
    headers: {
      apikey: env.publishableKey,
      authorization: `Bearer ${token}`,
      "tus-resumable": "1.0.0",
      "upload-offset": String(offset),
      "content-type": "application/offset+octet-stream",
    },
    body: new Blob([body as Uint8Array<ArrayBuffer>]),
    signal: AbortSignal.timeout(20_000),
  })
  await res.body?.cancel()
  return res
}

/** Mint as the user, then PUT the bytes with the token (lib/upload/signed-put.ts). */
async function mintSignedUpload(user: TestIdentity, key: string) {
  const { data, error } = await user.client.storage
    .from("media")
    .createSignedUploadUrl(key)
  if (error) throw error
  return data
}

async function putSigned(signedUrl: string) {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: { "content-type": "image/jpeg", "x-upsert": "false" },
    body: new Blob([TINY_BYTES]),
  })
  await res.body?.cancel()
  return res
}

beforeAll(async () => {
  venue = (await createVenue(service, "hardening")).id
  staff = await createIdentity(service, {
    label: "hardening-staff",
    role: "staff",
    venueId: venue,
  })
  admin = await createIdentity(service, {
    label: "hardening-admin",
    role: "admin",
  })
})

describe("finding 1: end users cannot sign or read storage objects directly", () => {
  let original: string
  let preview: string
  let avatar: string

  beforeAll(async () => {
    const row = await reserveOk(staff)
    original = row.original_path
    const put = await staff.client.storage
      .from("media")
      .upload(original, TINY_BYTES)
    if (put.error) throw put.error
    preview = original.replace("original.jpg", "preview.webp")
    const derivative = await service.storage
      .from("media")
      .upload(preview, TINY_BYTES, { contentType: "image/webp" })
    if (derivative.error) throw derivative.error
    // Derivative paths are fixed once ready, so record them while processing.
    await setRow(row.id, { upload_state: "processing", preview_path: preview })
    await markReady(service, row.id)
    avatar = `${staff.id}/${crypto.randomUUID()}.webp`
    const avatarPut = await service.storage
      .from("avatars")
      .upload(avatar, TINY_BYTES, { contentType: "image/webp" })
    if (avatarPut.error) throw avatarPut.error
  })

  for (const who of ["staff (owner)", "admin"] as const) {
    it(`${who}: a year-long signed URL for a ready original, derivative or avatar is refused`, async () => {
      const user = who === "admin" ? admin : staff
      for (const [bucket, key] of [
        ["media", original],
        ["media", preview],
        ["avatars", avatar],
      ] as const) {
        const { data, error } = await user.client.storage
          .from(bucket)
          .createSignedUrl(key, 365 * 24 * 3600)
        expect(error, `${bucket}/${key}`).not.toBeNull()
        expect(data).toBeNull()
        const many = await user.client.storage
          .from(bucket)
          .createSignedUrls([key], 60)
        expect(
          many.error !== null || many.data?.every((d) => !d.signedUrl)
        ).toBe(true)
      }
    })

    it(`${who}: direct download and listing of ready objects are refused`, async () => {
      const user = who === "admin" ? admin : staff
      for (const [bucket, key] of [
        ["media", original],
        ["media", preview],
        ["avatars", avatar],
      ] as const) {
        const download = await user.client.storage.from(bucket).download(key)
        expect(download.error, `${bucket}/${key}`).not.toBeNull()
        const listed = await user.client.storage
          .from(bucket)
          .list(key.slice(0, key.lastIndexOf("/")))
        expect(listed.data ?? []).toEqual([])
      }
    })
  }
})

describe("finding 1: the app read path still serves authorised callers", () => {
  let assetId: string
  let avatar: string
  let other: TestIdentity
  let leaver: TestIdentity

  /** Seconds between iat and exp of the signed URL's token. */
  function lifetime(url: string) {
    const token = new URL(url).searchParams.get("token")!
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    )
    return payload.exp - payload.iat
  }

  async function fetchBytes(url: string) {
    const res = await fetch(url)
    return { ok: res.ok, bytes: new Uint8Array(await res.arrayBuffer()) }
  }

  beforeAll(async () => {
    other = await createIdentity(service, {
      label: "hardening-other",
      role: "staff",
      venueId: venue,
    })
    leaver = await createIdentity(service, {
      label: "hardening-leaver",
      role: "staff",
      venueId: venue,
    })
    const row = await reserveOk(staff)
    assetId = row.id
    const put = await staff.client.storage
      .from("media")
      .upload(row.original_path, TINY_BYTES)
    if (put.error) throw put.error
    const preview = row.original_path.replace("original.jpg", "preview.webp")
    const derivative = await service.storage
      .from("media")
      .upload(preview, TINY_BYTES, { contentType: "image/webp" })
    if (derivative.error) throw derivative.error
    await setRow(row.id, { upload_state: "processing", preview_path: preview })
    await markReady(service, row.id)
    avatar = `${staff.id}/${crypto.randomUUID()}.webp`
    const avatarPut = await service.storage
      .from("avatars")
      .upload(avatar, TINY_BYTES, { contentType: "image/webp" })
    if (avatarPut.error) throw avatarPut.error
    const linked = await service
      .from("profiles")
      .update({ avatar_path: avatar })
      .eq("id", staff.id)
    if (linked.error) throw linked.error
  })

  for (const who of ["owner", "admin"] as const) {
    it(`${who}: derivative and avatar URLs are issued for 60 s and serve the bytes`, async () => {
      const actor = await actorFor(who === "admin" ? admin : staff)
      const derivative = await signDerivative(actor, assetId, "preview")
      expect(derivative.ok).toBe(true)
      if (!derivative.ok) return
      expect(lifetime(derivative.url)).toBe(MEDIA_LIMITS.signedUrlExpirySeconds)
      expect(await fetchBytes(derivative.url)).toEqual({
        ok: true,
        bytes: TINY_BYTES,
      })
      const photo = await signAvatar(actor, staff.id)
      expect(photo.ok).toBe(true)
      if (!photo.ok) return
      expect(lifetime(photo.url)).toBe(MEDIA_LIMITS.signedUrlExpirySeconds)
      expect((await fetchBytes(photo.url)).ok).toBe(true)
    })
  }

  it("another staff member gets nothing for someone else's asset or avatar", async () => {
    const actor = await actorFor(other)
    expect(await signDerivative(actor, assetId, "preview")).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(await signAvatar(actor, staff.id)).toMatchObject({
      ok: false,
      status: 404,
    })
  })

  it("a deactivated staff member is denied their own asset and avatar", async () => {
    const row = await reserveOk(leaver)
    const put = await leaver.client.storage
      .from("media")
      .upload(row.original_path, TINY_BYTES)
    if (put.error) throw put.error
    const preview = row.original_path.replace("original.jpg", "preview.webp")
    await service.storage
      .from("media")
      .upload(preview, TINY_BYTES, { contentType: "image/webp" })
    await setRow(row.id, { upload_state: "processing", preview_path: preview })
    await markReady(service, row.id)
    // Built while active (as a request already in flight would be), then deactivated.
    const actor = await actorFor(leaver)
    await setActive(leaver, false)
    try {
      expect(await signDerivative(actor, row.id, "preview")).toMatchObject({
        ok: false,
        status: 404,
      })
    } finally {
      await setActive(leaver, true)
    }
  })

  it("a deleted asset is denied to its owner and to admins", async () => {
    const row = await reserveOk(staff)
    const put = await staff.client.storage
      .from("media")
      .upload(row.original_path, TINY_BYTES)
    if (put.error) throw put.error
    const preview = row.original_path.replace("original.jpg", "preview.webp")
    await service.storage
      .from("media")
      .upload(preview, TINY_BYTES, { contentType: "image/webp" })
    await setRow(row.id, { upload_state: "processing", preview_path: preview })
    await markReady(service, row.id)
    const del = await staff.client.rpc("delete_media_asset", {
      p_asset_id: row.id,
    })
    expect(del.error).toBeNull()
    for (const user of [staff, admin]) {
      expect(
        await signDerivative(await actorFor(user), row.id, "preview")
      ).toMatchObject({ ok: false, status: 404 })
    }
  })
})

describe("finding 4: every write of an original re-checks the reservation", () => {
  it("a signed upload token still works while the reservation is open (control)", async () => {
    const row = await reserveOk(staff)
    const signed = await mintSignedUpload(staff, row.original_path)
    const res = await putSigned(signed.signedUrl)
    expect(res.ok).toBe(true)
    expect(await stored(row.original_path)).toBe(true)
  })

  for (const change of [
    "tombstoned",
    "processing",
    "failed",
    "uploader deactivated",
    "venue deactivated",
  ] as const) {
    it(`a signed upload token minted earlier is refused once the reservation is ${change}`, async () => {
      const row = await reserveOk(staff)
      const signed = await mintSignedUpload(staff, row.original_path)
      let restore = async () => {}
      if (change === "tombstoned") {
        const { error } = await staff.client.rpc("delete_media_asset", {
          p_asset_id: row.id,
        })
        if (error) throw error
      } else if (change === "processing" || change === "failed") {
        await setRow(row.id, { upload_state: "processing" })
        if (change === "failed")
          await setRow(row.id, { upload_state: "failed" })
      } else if (change === "uploader deactivated") {
        await setActive(staff, false)
        restore = () => setActive(staff, true)
      } else {
        await service.from("venues").update({ active: false }).eq("id", venue)
        restore = async () => {
          await service.from("venues").update({ active: true }).eq("id", venue)
        }
      }
      try {
        const res = await putSigned(signed.signedUrl)
        expect(res.ok).toBe(false)
        expect(await stored(row.original_path)).toBe(false)
      } finally {
        await restore()
      }
    })
  }

  it("TUS: a transfer whose reservation stays open completes (control)", async () => {
    const row = await reserveOk(staff)
    const token = await tokenOf(staff)
    const created = await tusCreate(token, row.original_path, TUS_CHUNK + 4)
    expect(created.status).toBe(201)
    const location = created.headers.get("location")!
    expect(
      (await tusPatch(token, location, 0, new Uint8Array(TUS_CHUNK))).status
    ).toBe(204)
    expect(
      (await tusPatch(token, location, TUS_CHUNK, TINY_BYTES)).status
    ).toBe(204)
    expect(await stored(row.original_path)).toBe(true)
  })

  for (const change of ["tombstoned", "processing"] as const) {
    it(`TUS: completion is refused when the reservation is ${change} mid-transfer`, async () => {
      const row = await reserveOk(staff)
      const token = await tokenOf(staff)
      const created = await tusCreate(token, row.original_path, TUS_CHUNK + 4)
      expect(created.status).toBe(201)
      const location = created.headers.get("location")!
      expect(
        (await tusPatch(token, location, 0, new Uint8Array(TUS_CHUNK))).status
      ).toBe(204)
      if (change === "tombstoned") {
        const { error } = await staff.client.rpc("delete_media_asset", {
          p_asset_id: row.id,
        })
        if (error) throw error
      } else {
        await setRow(row.id, { upload_state: "processing" })
      }
      const last = await tusPatch(token, location, TUS_CHUNK, TINY_BYTES)
      expect(last.ok).toBe(false)
      expect(await stored(row.original_path)).toBe(false)
    })
  }

  it("TUS: completion is refused when the uploader is deactivated mid-transfer", async () => {
    const row = await reserveOk(staff)
    const token = await tokenOf(staff)
    const created = await tusCreate(token, row.original_path, TUS_CHUNK + 4)
    expect(created.status).toBe(201)
    const location = created.headers.get("location")!
    expect(
      (await tusPatch(token, location, 0, new Uint8Array(TUS_CHUNK))).status
    ).toBe(204)
    await setActive(staff, false)
    try {
      const last = await tusPatch(token, location, TUS_CHUNK, TINY_BYTES)
      expect(last.ok).toBe(false)
      expect(await stored(row.original_path)).toBe(false)
    } finally {
      await setActive(staff, true)
    }
  })
})

describe("finding 5: reserve_media_asset enforces its own limits", () => {
  let capped: TestIdentity

  beforeAll(async () => {
    capped = await createIdentity(service, {
      label: "hardening-cap",
      role: "staff",
      venueId: venue,
    })
  })

  for (const [label, overrides] of [
    ["an HTML extension", { p_extension: "html" }],
    ["an SVG extension", { p_extension: "svg" }],
    ["a video extension on an image", { p_extension: "mp4" }],
    [
      "an image extension on a video",
      { p_media_type: "video", p_extension: "jpg" },
    ],
    ["a size above the bucket cap", { p_size_bytes: 999_999_999_999 }],
    ["a zero size", { p_size_bytes: 0 }],
    ["a negative size", { p_size_bytes: -1 }],
  ] as const) {
    it(`direct RPC with ${label} is refused`, async () => {
      const { row, error } = await reserve(staff, overrides)
      expect(row).toBeUndefined()
      expect(error?.message).toMatch(/invalid_extension|invalid_size/)
    })
  }

  it("a reservation without a client upload key or a size is refused", async () => {
    const keyless = await reserve(staff, { p_client_upload_key: null })
    expect(keyless.error?.message).toBe("invalid_upload_key")
    const sizeless = await reserve(staff, { p_size_bytes: null })
    expect(sizeless.error?.message).toBe("invalid_size")
  })

  it("per-type size caps match MEDIA_LIMITS exactly", async () => {
    for (const [type, ext, max] of [
      ["image", "jpg", MEDIA_LIMITS.maxPhotoBytes],
      ["video", "mp4", MEDIA_LIMITS.maxVideoBytes],
    ] as const) {
      const at = await reserve(staff, {
        p_media_type: type,
        p_extension: ext,
        p_size_bytes: max,
      })
      expect(at.error, `${type} at the limit`).toBeNull()
      const over = await reserve(staff, {
        p_media_type: type,
        p_extension: ext,
        p_size_bytes: max + 1,
      })
      expect(over.error?.message, `${type} one byte over`).toBe("invalid_size")
    }
  })

  it("allow-listed types and a size within the bucket cap are accepted", async () => {
    for (const [type, ext] of [
      ["image", "heic"],
      ["image", "png"],
      ["video", "mov"],
      ["video", "webm"],
    ]) {
      const { row, error } = await reserve(staff, {
        p_media_type: type,
        p_extension: ext,
        p_size_bytes: 1024,
      })
      expect(error).toBeNull()
      expect(row!.original_path.endsWith(`/original.${ext}`)).toBe(true)
    }
  })

  it("an uploader holds at most 20 open reservations; retries and deletions are handled", async () => {
    const keys: string[] = []
    const ids: string[] = []
    for (let i = 0; i < 20; i++) {
      const key = `hardening-cap-${i}-${crypto.randomUUID().slice(0, 8)}`
      const { row, error } = await reserve(capped, { p_client_upload_key: key })
      expect(error, `reservation ${i + 1}`).toBeNull()
      keys.push(key)
      ids.push(row!.id)
    }
    const over = await reserve(capped)
    expect(over.error?.message).toBe("too_many_open_uploads")

    // An idempotent retry of an open reservation still returns it.
    const retry = await reserve(capped, { p_client_upload_key: keys[0] })
    expect(retry.error).toBeNull()
    expect(retry.row).toMatchObject({ id: ids[0], reused: true })

    // Ready assets do not count; neither do deleted ones.
    await markReady(service, ids[1])
    expect((await reserve(capped)).error).toBeNull()
    expect((await reserve(capped)).error?.message).toBe("too_many_open_uploads")
    const del = await capped.client.rpc("delete_media_asset", {
      p_asset_id: ids[2],
    })
    expect(del.error).toBeNull()
    expect((await reserve(capped)).error).toBeNull()

    const { count } = await service
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("uploader_id", capped.id)
      .is("deleted_at", null)
      .neq("upload_state", "ready")
    expect(count).toBe(20)
  })

  it("concurrent reservations cannot overshoot the cap", async () => {
    const racer = await createIdentity(service, {
      label: "hardening-race",
      role: "staff",
      venueId: venue,
    })
    const results = await Promise.all(
      Array.from({ length: 30 }, () => reserve(racer))
    )
    expect(results.filter((r) => !r.error)).toHaveLength(20)
    expect(
      results.filter((r) => r.error?.message === "too_many_open_uploads")
    ).toHaveLength(10)
  })
})

describe("findings 3 and 6: claim maintenance RPCs are service-role only", () => {
  for (const who of ["staff", "admin"] as const) {
    it(`${who} cannot call fail_stale_media_processing or take_over_stale_media_claim`, async () => {
      const user = who === "admin" ? admin : staff
      const reap = await user.client.rpc("fail_stale_media_processing", {
        p_stale_after: "10 minutes",
      })
      expect(reap.error).not.toBeNull()
      const row = await reserveOk(staff)
      const take = await user.client.rpc("take_over_stale_media_claim", {
        p_asset_id: row.id,
        p_stale_after: "1 minute",
      })
      expect(take.error).not.toBeNull()
    })
  }
})
