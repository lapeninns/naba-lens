// Repros for docs/reviews/upload-path-review.md. Runs only against an isolated
// local stack (getLocalSupabaseEnv refuses non-local hosts). Each test logs what
// it observed; assertions describe the CURRENT (vulnerable or safe) behaviour.
import { createClient } from "@supabase/supabase-js"
import { beforeAll, describe, expect, it } from "vitest"

import type { Database } from "../../lib/db/types"
import { runMediaCleanup } from "../../lib/server/lifecycle/cleanup"
import { removeMediaAssetWith } from "../../lib/server/lifecycle/remove-media"
import { getReadableAsset, streamOriginal } from "../../lib/server/media/access"
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

async function tusCreate(
  token: string,
  key: string,
  length: number,
  opts: { upsert: boolean; contentType: string }
) {
  const res = await fetch(`${env().url}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      apikey: env().publishableKey,
      authorization: `Bearer ${token}`,
      "tus-resumable": "1.0.0",
      "upload-length": String(length),
      "x-upsert": String(opts.upsert),
      "upload-metadata": [
        `bucketName ${b64("media")}`,
        `objectName ${b64(key)}`,
        `contentType ${b64(opts.contentType)}`,
      ].join(","),
    },
  })
  return {
    status: res.status,
    location: res.headers.get("location"),
    body: await res.text(),
  }
}

async function tusPatch(token: string, location: string, bytes: Uint8Array) {
  const res = await fetch(location, {
    method: "PATCH",
    headers: {
      apikey: env().publishableKey,
      authorization: `Bearer ${token}`,
      "tus-resumable": "1.0.0",
      "upload-offset": "0",
      "content-type": "application/offset+octet-stream",
    },
    body: bytes,
  })
  return { status: res.status, body: await res.text() }
}

async function storedBytes(key: string) {
  const { data, error } = await admin.storage.from("media").download(key)
  if (error) return null
  return new Uint8Array(await data.arrayBuffer())
}

async function storedMeta(key: string) {
  const [folder, ...rest] = [
    key.split("/").slice(0, 2).join("/"),
    key.split("/")[2],
  ]
  const { data } = await admin.storage.from("media").list(folder)
  return data?.find((o) => o.name === rest[0]) ?? null
}

async function rowOf(id: string) {
  const { data } = await admin
    .from("media_assets")
    .select("*")
    .eq("id", id)
    .single()
  return data!
}

/** Reserve + signed PUT (as the browser) + finalise. */
async function uploadReady(
  actor: MediaActor,
  identity: TestIdentity,
  bytes: Uint8Array,
  contentType = "image/jpeg"
) {
  const input = req(bytes)
  const r = await reserveAsset(actor, input)
  if (!r.ok) throw new Error(r.message)
  const put = await identity.client.storage
    .from("media")
    .uploadToSignedUrl(r.objectKey, r.token!, bytes, { contentType })
  if (put.error) throw put.error
  const f = await finaliseAsset(actor, {
    assetId: r.assetId,
    idempotencyKey: input.idempotencyKey,
  })
  return { input, r, f }
}

describe("upload path review repros", () => {
  let venue: { id: string }
  let A: TestIdentity
  let B: TestIdentity
  let adminUser: TestIdentity
  let actorA: MediaActor
  let actorB: MediaActor
  let actorAdmin: MediaActor

  beforeAll(async () => {
    venue = await createVenue(admin, "uprev")
    A = await createIdentity(admin, {
      label: "uprev-a",
      role: "staff",
      venueId: venue.id,
    })
    B = await createIdentity(admin, {
      label: "uprev-b",
      role: "staff",
      venueId: venue.id,
    })
    adminUser = await createIdentity(admin, {
      label: "uprev-admin",
      role: "admin",
    })
    actorA = await actorFor(A)
    actorB = await actorFor(B)
    actorAdmin = await actorFor(adminUser)
  })

  it("R1: staff-minted upsert signed upload URL replaces a READY original after validation", async () => {
    const jpeg = await syntheticJpeg()
    const input = req(jpeg)
    const r = await reserveAsset(actorA, input)
    if (!r.ok) console.log("R1 reserve failed:", JSON.stringify(r))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // While `uploading`, the staff member mints their own upload URL with upsert.
    const minted = await A.client.storage
      .from("media")
      .createSignedUploadUrl(r.objectKey, { upsert: true })
    console.log("R1 mint upsert URL:", minted.error?.message ?? "ok")
    // Normal flow: valid JPEG, finalise -> ready.
    const put = await A.client.storage
      .from("media")
      .uploadToSignedUrl(r.objectKey, r.token!, jpeg, {
        contentType: "image/jpeg",
      })
    expect(put.error).toBeNull()
    const f = await finaliseAsset(actorA, {
      assetId: r.assetId,
      idempotencyKey: input.idempotencyKey,
    })
    expect(f).toMatchObject({ ok: true, state: "ready" })
    if (minted.error) return

    // After ready: replay the minted URL with different bytes.
    const res = await fetch(
      `${env().url}/storage/v1${new URL(minted.data!.signedUrl).pathname.replace(/^\/storage\/v1/, "")}${new URL(minted.data!.signedUrl).search}`,
      {
        method: "PUT",
        headers: { "content-type": "text/html", "x-upsert": "true" },
        body: HTML,
      }
    )
    console.log("R1 replay after ready:", res.status, await res.text())
    const now = await storedBytes(r.objectKey)
    const row = await rowOf(r.assetId)
    console.log(
      "R1 stored len",
      now?.byteLength,
      "row",
      row.upload_state,
      row.validated_mime_type,
      row.size_bytes
    )
    const meta = await storedMeta(r.objectKey)
    console.log("R1 storage metadata", meta?.metadata)

    // Admin download route serves the replaced bytes under the validated type.
    const readable = await getReadableAsset(actorAdmin, r.assetId)
    expect(readable.ok).toBe(true)
    if (!readable.ok) return
    const dl = await streamOriginal(actorAdmin, readable.asset, null)
    const body = new Uint8Array(await dl.arrayBuffer())
    console.log(
      "R1 download:",
      dl.status,
      dl.headers.get("content-type"),
      dl.headers.get("content-length"),
      "row size",
      row.size_bytes,
      "first bytes:",
      new TextDecoder().decode(body.slice(0, 15))
    )
  })

  it("R2: TUS upload created while `uploading` (x-upsert true) finishing after READY", async () => {
    const jpeg = await syntheticJpeg()
    const input = req(jpeg)
    const r = await reserveAsset(actorA, input)
    if (!r.ok) throw new Error(r.message)
    const token = await tokenOf(A)
    const created = await tusCreate(token, r.objectKey, HTML.byteLength, {
      upsert: true,
      contentType: "text/html",
    })
    console.log(
      "R2 TUS create (upsert):",
      created.status,
      created.body.slice(0, 120)
    )
    const put = await A.client.storage
      .from("media")
      .uploadToSignedUrl(r.objectKey, r.token!, jpeg, {
        contentType: "image/jpeg",
      })
    expect(put.error).toBeNull()
    const f = await finaliseAsset(actorA, {
      assetId: r.assetId,
      idempotencyKey: input.idempotencyKey,
    })
    expect(f).toMatchObject({ ok: true, state: "ready" })
    if (!created.location) return
    const patched = await tusPatch(token, created.location, HTML)
    console.log(
      "R2 TUS patch after ready:",
      patched.status,
      patched.body.slice(0, 160)
    )
    const now = await storedBytes(r.objectKey)
    console.log(
      "R2 stored len",
      now?.byteLength,
      "(jpeg was",
      jpeg.byteLength,
      ")"
    )
  })

  it("R2b: TUS (x-upsert false) created while `uploading`, finished after delete", async () => {
    const jpeg = await syntheticJpeg()
    const input = req(jpeg)
    const r = await reserveAsset(actorA, input)
    if (!r.ok) throw new Error(r.message)
    const token = await tokenOf(A)
    const created = await tusCreate(token, r.objectKey, HTML.byteLength, {
      upsert: false,
      contentType: "text/html",
    })
    console.log("R2b TUS create:", created.status)
    const del = await removeMediaAssetWith(
      { user: A.client, service: admin },
      r.assetId
    )
    console.log("R2b delete:", JSON.stringify(del))
    if (!created.location) return
    const patched = await tusPatch(token, created.location, HTML)
    console.log(
      "R2b TUS patch after delete:",
      patched.status,
      patched.body.slice(0, 160)
    )
    console.log(
      "R2b object exists after delete:",
      (await storedBytes(r.objectKey)) !== null
    )
    // And the server-issued (upsert=false) URL replayed after delete:
    const put = await A.client.storage
      .from("media")
      .uploadToSignedUrl(r.objectKey, r.token!, HTML, {
        contentType: "text/html",
      })
    console.log("R2b signed PUT after delete:", put.error?.message ?? "stored")
  })

  it("R3 (control): server-issued signed URL cannot overwrite after ready", async () => {
    const jpeg = await syntheticJpeg()
    const { r, f } = await uploadReady(actorA, A, jpeg)
    expect(f).toMatchObject({ ok: true, state: "ready" })
    if (!r.ok) return
    const again = await A.client.storage
      .from("media")
      .uploadToSignedUrl(r.objectKey, r.token!, HTML, {
        contentType: "text/html",
        upsert: true,
      })
    console.log("R3 replay server URL:", again.error?.message ?? "stored")
    expect((await storedBytes(r.objectKey))?.byteLength).toBe(jpeg.byteLength)
  })

  it("R4: client Content-Type is stored and served by storage; staff can mint long-lived signed read URLs", async () => {
    const jpeg = await syntheticJpeg()
    const { r, f } = await uploadReady(actorA, A, jpeg, "text/html")
    expect(f).toMatchObject({ ok: true, state: "ready" })
    if (!r.ok) return
    console.log(
      "R4 row validated mime:",
      (await rowOf(r.assetId)).validated_mime_type
    )
    const signed = await A.client.storage
      .from("media")
      .createSignedUrl(r.objectKey, 60 * 60 * 24 * 365)
    console.log(
      "R4 1-year signed URL by staff:",
      signed.error?.message ?? "issued"
    )
    if (!signed.data) return
    const res = await fetch(signed.data.signedUrl)
    console.log(
      "R4 GET:",
      res.status,
      "content-type:",
      res.headers.get("content-type"),
      "nosniff:",
      res.headers.get("x-content-type-options"),
      "disposition:",
      res.headers.get("content-disposition")
    )
    // Deactivate the staff member: the URL keeps working.
    await admin.from("profiles").update({ active: false }).eq("id", A.id)
    try {
      const after = await fetch(signed.data.signedUrl)
      console.log("R4 GET after deactivation:", after.status)
    } finally {
      await admin.from("profiles").update({ active: true }).eq("id", A.id)
    }
  })

  it("R5: declared size is never compared with stored size; oversized image object retained after failure", async () => {
    const jpeg = await syntheticJpeg(2000, 1500)
    // Declare 10 bytes, upload the real thing.
    const input = req(jpeg, { sizeBytes: 10 })
    const r = await reserveAsset(actorA, input)
    if (!r.ok) throw new Error(r.message)
    console.log(
      "R5 reserved with size 10, resumable:",
      r.resumable,
      "row size",
      (await rowOf(r.assetId)).size_bytes
    )
    await A.client.storage
      .from("media")
      .uploadToSignedUrl(r.objectKey, r.token!, jpeg, {
        contentType: "image/jpeg",
      })
    const f = await finaliseAsset(actorA, {
      assetId: r.assetId,
      idempotencyKey: input.idempotencyKey,
    })
    console.log(
      "R5 finalise:",
      JSON.stringify(f),
      "row size now",
      (await rowOf(r.assetId)).size_bytes,
      "actual",
      jpeg.byteLength
    )

    // Image reservation declared 1 KB; 25 MiB stored through the same signed URL path.
    const big = new Uint8Array(25 * 1024 * 1024)
    big.set(jpeg.slice(0, 1024)) // JPEG magic up front
    const input2 = req(big, { sizeBytes: 1024 })
    const r2 = await reserveAsset(actorA, input2)
    if (!r2.ok) throw new Error(r2.message)
    const put2 = await A.client.storage
      .from("media")
      .uploadToSignedUrl(r2.objectKey, r2.token!, big, {
        contentType: "image/jpeg",
      })
    console.log(
      "R5 25MiB stored into a 1KB image reservation:",
      put2.error?.message ?? "stored"
    )
    const f2 = await finaliseAsset(actorA, {
      assetId: r2.assetId,
      idempotencyKey: input2.idempotencyKey,
    })
    console.log(
      "R5 finalise big:",
      JSON.stringify(f2),
      "state",
      (await rowOf(r2.assetId)).upload_state
    )
    const report = await runMediaCleanup(admin)
    console.log("R5 cleanup now:", JSON.stringify(report))
    console.log(
      "R5 failed object still stored:",
      (await storedBytes(r2.objectKey))?.byteLength
    )
  })

  it("R6: delete racing finalise -> row ready+deleted and derivatives written after removal", async () => {
    const jpeg = await syntheticJpeg()
    const input = req(jpeg)
    const r = await reserveAsset(actorA, input)
    if (!r.ok) throw new Error(r.message)
    await A.client.storage
      .from("media")
      .uploadToSignedUrl(r.objectKey, r.token!, jpeg, {
        contentType: "image/jpeg",
      })
    let deleted: unknown = null
    // Service client that deletes the asset (as its owner) just before the first
    // derivative write: i.e. the user presses Delete while finalise is running.
    const racingService = createClient<Database>(
      env().url,
      env().serviceRoleKey,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: async (url, init) => {
            if (!deleted && String(url).includes("/preview.webp")) {
              deleted = await removeMediaAssetWith(
                { user: A.client, service: admin },
                r.assetId
              )
            }
            return fetch(url, init)
          },
        },
      }
    )
    const f = await finaliseAsset(
      { ...actorA, service: racingService },
      { assetId: r.assetId, idempotencyKey: input.idempotencyKey }
    )
    const row = await rowOf(r.assetId)
    const { data: left } = await admin.storage
      .from("media")
      .list(`${A.id}/${r.assetId}`)
    console.log(
      "R6 delete:",
      JSON.stringify(deleted),
      "finalise:",
      JSON.stringify(f),
      "row:",
      row.upload_state,
      "deleted_at set:",
      row.deleted_at !== null,
      "objects left:",
      left?.map((o) => o.name)
    )
  })

  it("R7: crashed `processing` claim is never cleaned up", async () => {
    const jpeg = await syntheticJpeg()
    const input = req(jpeg)
    const r = await reserveAsset(actorA, input)
    if (!r.ok) throw new Error(r.message)
    await A.client.storage
      .from("media")
      .uploadToSignedUrl(r.objectKey, r.token!, jpeg, {
        contentType: "image/jpeg",
      })
    // Simulate a finalise that claimed the row and crashed (process killed).
    await admin
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", r.assetId)
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000)
    const report = await runMediaCleanup(admin, { now: future })
    const row = await rowOf(r.assetId)
    console.log(
      "R7 cleanup @+30d:",
      JSON.stringify(report.status),
      "row:",
      row.upload_state,
      "deleted_at:",
      row.deleted_at,
      "object kept:",
      (await storedBytes(r.objectKey)) !== null
    )
    // Only a client retry of finalise (after 2 min stale) would recover it.
  })

  it("R8: duplicate finalise and duplicate reserve races", async () => {
    const jpeg = await syntheticJpeg(3000, 2000)
    const input = req(jpeg)
    const many = await Promise.all(
      Array.from({ length: 5 }, () => reserveAsset(actorA, input))
    )
    const ids = new Set(many.map((m) => (m.ok ? m.assetId : m.message)))
    console.log("R8 concurrent reserve same key -> distinct assets:", ids.size)
    const r = many[0]
    if (!r.ok) throw new Error(r.message)
    const url = many.find((m) => m.ok && m.token)
    if (!url || !url.ok) throw new Error("no URL")
    await A.client.storage
      .from("media")
      .uploadToSignedUrl(url.objectKey, url.token!, jpeg, {
        contentType: "image/jpeg",
      })
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        finaliseAsset(actorA, {
          assetId: r.assetId,
          idempotencyKey: input.idempotencyKey,
        })
      )
    )
    console.log("R8 concurrent finalise:", JSON.stringify(results))
    const { count } = await admin
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("client_upload_key", input.idempotencyKey)
    console.log(
      "R8 rows for key:",
      count,
      "state:",
      (await rowOf(r.assetId)).upload_state
    )
  })

  it("R9: finalising someone else's asset / wrong key", async () => {
    const jpeg = await syntheticJpeg()
    const input = req(jpeg)
    const r = await reserveAsset(actorA, input)
    if (!r.ok) throw new Error(r.message)
    await A.client.storage
      .from("media")
      .uploadToSignedUrl(r.objectKey, r.token!, jpeg, {
        contentType: "image/jpeg",
      })
    const byB = await finaliseAsset(actorB, {
      assetId: r.assetId,
      idempotencyKey: input.idempotencyKey,
    })
    const wrongKey = await finaliseAsset(actorA, {
      assetId: r.assetId,
      idempotencyKey: newKey(),
    })
    const byAdmin = await finaliseAsset(actorAdmin, {
      assetId: r.assetId,
      idempotencyKey: input.idempotencyKey,
    })
    console.log(
      "R9 B:",
      JSON.stringify(byB),
      "wrong key:",
      JSON.stringify(wrongKey),
      "admin:",
      JSON.stringify(byAdmin),
      "state:",
      (await rowOf(r.assetId)).upload_state
    )
    // B uploading into A's reserved key directly and through a minted signed URL.
    const direct = await B.client.storage
      .from("media")
      .upload(r.objectKey.replace("original", "x"), jpeg)
    const mint = await B.client.storage
      .from("media")
      .createSignedUploadUrl(r.objectKey)
    const mintDerivative = await A.client.storage
      .from("media")
      .createSignedUploadUrl(`${A.id}/${r.assetId}/preview.webp`)
    console.log(
      "R9 B direct:",
      direct.error?.message,
      "B mint:",
      mint.error?.message,
      "A mint derivative:",
      mintDerivative.error?.message ?? "issued"
    )
  })
  it("R4b: polyglot JPEG uploaded with text/html is validated ready and storage serves text/html", async () => {
    const jpeg = await syntheticJpeg()
    const poly = new Uint8Array(jpeg.byteLength + HTML.byteLength)
    poly.set(jpeg)
    poly.set(HTML, jpeg.byteLength)
    const input = req(poly)
    const r = await reserveAsset(actorA, input)
    if (!r.ok) throw new Error(r.message)
    const put = await fetch(r.uploadUrl!, { method: "PUT", headers: { "content-type": "text/html", "x-upsert": "false" }, body: poly })
    console.log("R4b raw PUT:", put.status)
    const f = await finaliseAsset(actorA, { assetId: r.assetId, idempotencyKey: input.idempotencyKey })
    console.log("R4b finalise:", JSON.stringify(f), "validated:", (await rowOf(r.assetId)).validated_mime_type, "storage metadata:", JSON.stringify((await storedMeta(r.objectKey))?.metadata))
    const signed = await A.client.storage.from("media").createSignedUrl(r.objectKey, 3600)
    const res = await fetch(signed.data!.signedUrl)
    console.log("R4b storage GET:", res.status, "content-type:", res.headers.get("content-type"), "nosniff:", res.headers.get("x-content-type-options"), "csp:", res.headers.get("content-security-policy"))
    const auth = await fetch(`${env().url}/storage/v1/object/authenticated/media/${r.objectKey}`, { headers: { apikey: env().publishableKey, authorization: `Bearer ${await tokenOf(A)}` } })
    console.log("R4b authenticated GET:", auth.status, "content-type:", auth.headers.get("content-type"))
    const readable = await getReadableAsset(actorAdmin, r.assetId)
    if (readable.ok) {
      const dl = await streamOriginal(actorAdmin, readable.asset, null)
      console.log("R4b app download route:", dl.status, dl.headers.get("content-type"), dl.headers.get("content-disposition"), dl.headers.get("x-content-type-options"))
    }
  })

  it("R10: direct reserve_media_asset RPC bypasses reserve.ts extension/size checks", async () => {
    const { data, error } = await A.client.rpc("reserve_media_asset", {
      p_media_type: "image",
      p_extension: "html",
      p_original_filename: "index.html",
      p_size_bytes: 999999999999,
    })
    console.log("R10 rpc:", error?.message ?? JSON.stringify(data))
    if (!data?.[0]) return
    const key = data[0].original_path
    const up = await A.client.storage.from("media").upload(key, HTML, { contentType: "text/html" })
    console.log("R10 direct upload to", key.split("/").pop(), ":", up.error?.message ?? "stored")
    const f = await finaliseAsset(actorA, { assetId: data[0].id, idempotencyKey: "" })
    console.log("R10 finalise (no key on row):", JSON.stringify(f), "row size_bytes", (await rowOf(data[0].id)).size_bytes)
  })
  it("R4c: which client Content-Types storage serves back verbatim", async () => {
    const jpeg = await syntheticJpeg()
    for (const ct of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/pdf", "text/javascript"]) {
      const input = req(jpeg)
      const r = await reserveAsset(actorA, input)
      if (!r.ok) throw new Error(r.message)
      await fetch(r.uploadUrl!, { method: "PUT", headers: { "content-type": ct, "x-upsert": "false" }, body: jpeg })
      await finaliseAsset(actorA, { assetId: r.assetId, idempotencyKey: input.idempotencyKey })
      const signed = await A.client.storage.from("media").createSignedUrl(r.objectKey, 60)
      const res = await fetch(signed.data!.signedUrl)
      console.log("R4c", ct, "->", res.status, res.headers.get("content-type"), "row:", (await rowOf(r.assetId)).upload_state)
    }
  })
})
