// Regression tests from the upload-path review (review/nl-upload-path2,
// docs/reviews/upload-path-review.md, Appendix A repros), with expectations set to
// the FIXED behaviour. Covered here: F1 (R4, R4b, R4c), F3 (R7), F5 (R10) and
// F6 (R2b). F2 (R6) and F4 (R5) are fixed by the uploads track in finalise.ts.
// Real signed-in identities; the service role only arranges state and reads back.
import { execFileSync } from "node:child_process"

import { beforeAll, describe, expect, it } from "vitest"

import { MEDIA_LIMITS } from "../../lib/config/media"
import { listMediaForUploader } from "../../lib/server/accounts/portfolio"
import { runMediaCleanup } from "../../lib/server/lifecycle/cleanup"
import { removeMediaAssetWith } from "../../lib/server/lifecycle/remove-media"
import {
  getReadableAsset,
  signDerivative,
  streamOriginal,
} from "../../lib/server/media/access"
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
  markReady,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"

const admin = serviceClient()
const env = () => getLocalSupabaseEnv()
const HTML = new TextEncoder().encode(
  "<!doctype html><title>x</title><script>document.title='replaced'</script>"
)

function req(
  bytes: Uint8Array,
  o: Partial<ReserveRequest> = {}
): ReserveRequest {
  return {
    idempotencyKey: newKey(),
    filename: "dish.jpg",
    sizeBytes: bytes.byteLength,
    contentType: "image/jpeg",
    mediaType: "image",
    preferResumable: false,
    ...o,
  }
}

async function tokenOf(identity: TestIdentity) {
  const { data } = await identity.client.auth.getSession()
  return data.session!.access_token
}

const b64 = (s: string) => Buffer.from(s).toString("base64")

async function storedBytes(key: string) {
  const { data, error } = await admin.storage.from("media").download(key)
  if (error) return null
  return new Uint8Array(await data.arrayBuffer())
}

async function rowOf(id: string) {
  const { data } = await admin
    .from("media_assets")
    .select("*")
    .eq("id", id)
    .single()
  return data!
}

/** Ages a finalise claim by database time (psql, local stack only). */
function ageClaim(assetId: string, minutes: number) {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  execFileSync(
    "psql",
    [
      url,
      "-v",
      "ON_ERROR_STOP=1",
      "-qAtc",
      `set session_replication_role = replica; update public.media_assets set updated_at = now() - interval '${minutes} minutes' where id = '${assetId}'`,
    ],
    { encoding: "utf8" }
  )
}

/** Reserve (app path), raw signed PUT with a chosen Content-Type, finalise. */
async function uploadReady(
  actor: MediaActor,
  bytes: Uint8Array,
  contentType = "image/jpeg"
) {
  const input = req(bytes)
  const r = await reserveAsset(actor, input)
  if (!r.ok) throw new Error(r.message)
  const put = await fetch(r.uploadUrl!, {
    method: "PUT",
    headers: { "content-type": contentType, "x-upsert": "false" },
    body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
  })
  expect(put.ok).toBe(true)
  const f = await finaliseAsset(actor, {
    assetId: r.assetId,
    idempotencyKey: input.idempotencyKey,
  })
  expect(f).toEqual({ ok: true, state: "ready" })
  return { input, r }
}

describe("upload path review: regressions (fixed behaviour)", () => {
  let venue: { id: string }
  let A: TestIdentity
  let adminUser: TestIdentity
  let actorA: MediaActor
  let actorAdmin: MediaActor

  beforeAll(async () => {
    venue = await createVenue(admin, "uprev-regr")
    A = await createIdentity(admin, {
      label: "uprev-regr-a",
      role: "staff",
      venueId: venue.id,
    })
    adminUser = await createIdentity(admin, {
      label: "uprev-regr-admin",
      role: "admin",
    })
    actorA = await actorFor(A)
    actorAdmin = await actorFor(adminUser)
  })

  it("R2b (F6): after delete, a TUS completion and a replayed server-issued signed URL both store nothing", async () => {
    const jpeg = await syntheticJpeg()
    const input = req(jpeg)
    const r = await reserveAsset(actorA, input)
    if (!r.ok) throw new Error(r.message)
    const token = await tokenOf(A)
    const created = await fetch(`${env().url}/storage/v1/upload/resumable`, {
      method: "POST",
      headers: {
        apikey: env().publishableKey,
        authorization: `Bearer ${token}`,
        "tus-resumable": "1.0.0",
        "upload-length": String(HTML.byteLength),
        "x-upsert": "false",
        "upload-metadata": [
          `bucketName ${b64("media")}`,
          `objectName ${b64(r.objectKey)}`,
          `contentType ${b64("text/html")}`,
        ].join(","),
      },
    })
    await created.body?.cancel()
    expect(created.status).toBe(201)
    const del = await removeMediaAssetWith(
      { user: A.client, service: admin },
      r.assetId
    )
    expect(del).toMatchObject({ ok: true })

    const patched = await fetch(created.headers.get("location")!, {
      method: "PATCH",
      headers: {
        apikey: env().publishableKey,
        authorization: `Bearer ${token}`,
        "tus-resumable": "1.0.0",
        "upload-offset": "0",
        "content-type": "application/offset+octet-stream",
      },
      body: new Blob([HTML]),
    })
    await patched.body?.cancel()
    expect(patched.ok).toBe(false)

    const put = await A.client.storage
      .from("media")
      .uploadToSignedUrl(r.objectKey, r.token!, HTML, {
        contentType: "text/html",
      })
    expect(put.error).not.toBeNull()
    expect(await storedBytes(r.objectKey)).toBeNull()
  })

  it("R4 (F1): staff cannot mint a signed read URL for their own original, so nothing outlives deactivation", async () => {
    const jpeg = await syntheticJpeg()
    const { r } = await uploadReady(actorA, jpeg, "text/html")
    if (!r.ok) return
    const signed = await A.client.storage
      .from("media")
      .createSignedUrl(r.objectKey, 60 * 60 * 24 * 365)
    expect(signed.error).not.toBeNull()
    expect(signed.data).toBeNull()
    const authenticated = await fetch(
      `${env().url}/storage/v1/object/authenticated/media/${r.objectKey}`,
      {
        headers: {
          apikey: env().publishableKey,
          authorization: `Bearer ${await tokenOf(A)}`,
        },
      }
    )
    await authenticated.body?.cancel()
    expect(authenticated.ok).toBe(false)
  })

  it("R4b (F1): a JPEG+HTML polyglot sent as text/html is only ever served with the validated type, attachment and nosniff", async () => {
    const jpeg = await syntheticJpeg()
    const poly = new Uint8Array(jpeg.byteLength + HTML.byteLength)
    poly.set(jpeg)
    poly.set(HTML, jpeg.byteLength)
    const { r } = await uploadReady(actorA, poly, "text/html")
    if (!r.ok) return
    expect((await rowOf(r.assetId)).validated_mime_type).toBe("image/jpeg")

    for (const user of [A, adminUser]) {
      const signed = await user.client.storage
        .from("media")
        .createSignedUrl(r.objectKey, 3600)
      expect(signed.error).not.toBeNull()
    }

    const readable = await getReadableAsset(actorAdmin, r.assetId)
    expect(readable.ok).toBe(true)
    if (!readable.ok) return
    const dl = await streamOriginal(actorAdmin, readable.asset, null)
    await dl.body?.cancel()
    expect(dl.status).toBe(200)
    expect(dl.headers.get("content-type")).toBe("image/jpeg")
    expect(dl.headers.get("content-disposition")).toMatch(
      /^attachment; filename="dish\.jpg"/
    )
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("R4c (F1): whatever Content-Type the client sent, no app-issued URL points at an original; derivatives are served as server-set WebP", async () => {
    const jpeg = await syntheticJpeg()
    const ids: string[] = []
    for (const ct of [
      "text/html",
      "image/svg+xml",
      "application/xhtml+xml",
      "text/xml",
      "application/pdf",
      "text/javascript",
    ]) {
      const { r } = await uploadReady(actorA, jpeg, ct)
      if (!r.ok) continue
      ids.push(r.assetId)
      const signed = await A.client.storage
        .from("media")
        .createSignedUrl(r.objectKey, 60)
      expect(signed.error, ct).not.toBeNull()

      for (const actor of [actorA, actorAdmin]) {
        for (const which of ["thumbnail", "preview"] as const) {
          const derivative = await signDerivative(actor, r.assetId, which)
          expect(derivative.ok, `${ct} ${which}`).toBe(true)
          if (!derivative.ok) continue
          expect(derivative.url).not.toContain("/original.")
          const res = await fetch(derivative.url)
          await res.body?.cancel()
          expect(res.status).toBe(200)
          expect(res.headers.get("content-type")).toBe("image/webp")
        }
      }
    }

    // The admin portfolio (lib/server/accounts) signs derivatives only; a video
    // plays through the authorised stream route, never a signed original.
    const videoKey = newKey()
    const video = await A.client.rpc("reserve_media_asset", {
      p_media_type: "video",
      p_extension: "mp4",
      p_original_filename: "clip.mp4",
      p_size_bytes: 4,
      p_client_upload_key: videoKey,
    })
    if (video.error) throw video.error
    const videoId = video.data[0].id
    await markReady(admin, videoId, "video/mp4")
    const page = await listMediaForUploader(
      { caller: adminUser.client, service: admin },
      A.id,
      { limit: 100 }
    )
    expect(page.ok).toBe(true)
    if (!page.ok) return
    const urls = page.items.flatMap((i) => [i.thumbnailUrl, i.previewUrl])
    expect(urls.filter(Boolean).length).toBeGreaterThan(0)
    for (const url of urls)
      if (url)
        expect(
          url.includes("/original.") && !url.startsWith("/api/media/")
        ).toBe(false)
    for (const id of ids)
      expect(page.items.some((item) => item.id === id)).toBe(true)
    expect(page.items.find((item) => item.id === videoId)?.previewUrl).toBe(
      `/api/media/${videoId}/stream`
    )
  })

  it("R7 (F3): a crashed `processing` claim is reaped by cleanup to `failed`, bytes kept for a retry", async () => {
    const jpeg = await syntheticJpeg()
    const input = req(jpeg)
    const r = await reserveAsset(actorA, input)
    if (!r.ok) throw new Error(r.message)
    await A.client.storage
      .from("media")
      .uploadToSignedUrl(r.objectKey, r.token!, jpeg, {
        contentType: "image/jpeg",
      })
    // A finalise that claimed the row and crashed (process killed).
    await admin
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", r.assetId)
    ageClaim(r.assetId, MEDIA_LIMITS.staleProcessingMinutes + 1)

    const report = await runMediaCleanup(admin)
    expect(report.status).toBe("completed")
    if (report.status !== "completed") return
    expect(report.reaped.assetIds).toContain(r.assetId)
    const row = await rowOf(r.assetId)
    expect(row.upload_state).toBe("failed")
    expect(row.deleted_at).toBeNull()
    expect(await storedBytes(r.objectKey)).not.toBeNull()

    const retried = await finaliseAsset(actorA, {
      assetId: r.assetId,
      idempotencyKey: input.idempotencyKey,
    })
    expect(retried).toEqual({ ok: true, state: "ready" })
  })

  it("R10 (F5): the reserve RPC refuses original.html, oversized and keyless reservations", async () => {
    const attempts = [
      // The review's exact call: html, absurd size, no key.
      {
        p_media_type: "image",
        p_extension: "html",
        p_original_filename: "index.html",
        p_size_bytes: 999999999999,
      },
      // Each control on its own, with everything else valid.
      {
        p_media_type: "image",
        p_extension: "html",
        p_original_filename: "index.html",
        p_size_bytes: 100,
        p_client_upload_key: newKey(),
      },
      {
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: "big.jpg",
        p_size_bytes: MEDIA_LIMITS.maxPhotoBytes + 1,
        p_client_upload_key: newKey(),
      },
      {
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: "nokey.jpg",
        p_size_bytes: 100,
      },
    ] as const
    for (const args of attempts) {
      const { data, error } = await A.client.rpc("reserve_media_asset", args)
      expect(error?.message, JSON.stringify(args)).toMatch(
        /invalid_extension|invalid_size|invalid_upload_key/
      )
      expect(data).toBeNull()
    }
    const { count } = await admin
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("uploader_id", A.id)
      .like("original_path", "%.html")
    expect(count).toBe(0)
  })
})
