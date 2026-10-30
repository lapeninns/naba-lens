import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { CLEANUP_LEASE, runMediaCleanup } from "@/lib/server/lifecycle/cleanup"
import {
  removeMediaAssetWith,
  type RemoveMediaAssetResult,
} from "@/lib/server/lifecycle/remove-media"
import {
  anonClient,
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  TINY_BYTES,
  type Db,
  type TestIdentity,
} from "../support/identities"
import { getReadableAsset, streamOriginal } from "@/lib/server/media/access"
import { actorFor } from "../slice/media-actor"

const service = serviceClient()
const media = () => service.storage.from("media")

/** psql against the isolated stack: lets tests age rows past the 24 h window. */
function sql(statement: string) {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url) throw new Error("Run through `pnpm test:lifecycle <workdir>`.")
  if (!/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Refusing to run SQL against a non-local database.")
  }
  return execFileSync(
    "psql",
    [url, "-v", "ON_ERROR_STOP=1", "-qAtc", statement],
    {
      encoding: "utf8",
    }
  ).trim()
}

/** Moves an asset's row (and optionally its objects) `hours` into the past, bypassing triggers. */
function age(assetId: string, hours: number, objects = true) {
  const statements = [
    "set session_replication_role = replica",
    `update public.media_assets set updated_at = now() - interval '${hours} hours' where id = '${assetId}'`,
  ]
  if (objects) {
    statements.push(
      `update storage.objects set created_at = now() - interval '${hours} hours', updated_at = now() - interval '${hours} hours' where bucket_id = 'media' and name like '%/${assetId}/%'`
    )
  }
  sql(statements.join("; "))
}

async function objectsOf(asset: { uploaderId: string; id: string }) {
  const { data, error } = await media().list(`${asset.uploaderId}/${asset.id}`)
  if (error) throw error
  return (data ?? []).map((o) => o.name).sort()
}

async function row(id: string) {
  const { data, error } = await service
    .from("media_assets")
    .select("id, upload_state, deleted_at, updated_at")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

type Asset = { id: string; uploaderId: string; originalPath: string }

async function reserve(staff: TestIdentity, upload = true): Promise<Asset> {
  const { data, error } = await staff.client.rpc("reserve_media_asset", {
    p_media_type: "image",
    p_extension: "jpg",
    p_original_filename: "lifecycle.jpg",
  })
  if (error) throw error
  const asset = {
    id: data[0].id,
    uploaderId: staff.id,
    originalPath: data[0].original_path,
  }
  if (upload) {
    const put = await staff.client.storage
      .from("media")
      .upload(asset.originalPath, TINY_BYTES, { contentType: "image/jpeg" })
    if (put.error) throw put.error
  }
  return asset
}

/** A ready asset with an original, a preview and a thumbnail. */
async function readyAsset(staff: TestIdentity): Promise<Asset> {
  const asset = await reserve(staff)
  for (const name of ["preview.webp", "thumb.webp"]) {
    const put = await media().upload(
      `${staff.id}/${asset.id}/${name}`,
      new Uint8Array([1, 2, 3]),
      { contentType: "image/webp" }
    )
    if (put.error) throw put.error
  }
  const processing = await service
    .from("media_assets")
    .update({
      upload_state: "processing",
      preview_path: `${staff.id}/${asset.id}/preview.webp`,
      thumbnail_path: `${staff.id}/${asset.id}/thumb.webp`,
    })
    .eq("id", asset.id)
  if (processing.error) throw processing.error
  await markReady(service, asset.id)
  return asset
}

function remove(
  as: Db,
  assetId: string,
  removeObjects?: (k: string[]) => Promise<void>
) {
  return removeMediaAssetWith({ user: as, service, removeObjects }, assetId)
}

async function visibleTo(client: Db, id: string) {
  const { data, error } = await client
    .from("media_assets")
    .select("id")
    .eq("id", id)
  if (error) throw error
  return data.length > 0
}

async function canSign(client: Db, path: string) {
  const { data, error } = await client.storage
    .from("media")
    .createSignedUrl(path, 60)
  return !error && Boolean(data?.signedUrl)
}

/** The app's read path: authorise caller and asset, then serve the original. */
async function readsThroughApp(identity: TestIdentity, assetId: string) {
  const actor = await actorFor(identity)
  const found = await getReadableAsset(actor, assetId)
  if (!found.ok) return false
  const response = await streamOriginal(actor, found.asset, null)
  await response.body?.cancel()
  return response.status === 200
}

const failingRemover = async () => {
  throw new Error("simulated storage outage")
}

describe("media lifecycle: removal, cleanup, deactivation", () => {
  let staffA: TestIdentity
  let staffB: TestIdentity
  let admin: TestIdentity

  beforeAll(async () => {
    const venue = await createVenue(service, "lc")
    staffA = await createIdentity(service, {
      label: "lc-a",
      role: "staff",
      venueId: venue.id,
    })
    staffB = await createIdentity(service, {
      label: "lc-b",
      role: "staff",
      venueId: venue.id,
    })
    admin = await createIdentity(service, { label: "lc-admin", role: "admin" })
    // Start from a clean slate: leftovers from earlier runs on this stack.
    await runMediaCleanup(service)
  })

  afterAll(async () => {
    await service.rpc("release_maintenance_lease", {
      p_name: CLEANUP_LEASE,
      p_holder: "00000000-0000-0000-0000-000000000001",
    })
  })

  describe("removeMediaAsset", () => {
    it("staff removes their own asset: hidden from both views, unsignable, objects gone", async () => {
      const asset = await readyAsset(staffA)
      expect(await visibleTo(staffA.client, asset.id)).toBe(true)
      expect(await visibleTo(admin.client, asset.id)).toBe(true)
      // End users never sign storage URLs themselves (wave 3 finding 1); the
      // object exists, and the app's authorised read path serves it.
      expect(await canSign(admin.client, asset.originalPath)).toBe(false)
      expect(await canSign(service, asset.originalPath)).toBe(true)
      expect(await readsThroughApp(admin, asset.id)).toBe(true)

      const result = await remove(staffA.client, asset.id)
      expect(result).toEqual({
        ok: true,
        assetId: asset.id,
        storage: "removed",
      })

      expect((await row(asset.id)).deleted_at).not.toBeNull()
      expect(await visibleTo(staffA.client, asset.id)).toBe(false)
      expect(await visibleTo(admin.client, asset.id)).toBe(false)
      expect(await canSign(staffA.client, asset.originalPath)).toBe(false)
      expect(await canSign(admin.client, asset.originalPath)).toBe(false)
      expect(await readsThroughApp(admin, asset.id)).toBe(false)
      // Not even the service role can sign: the bytes are gone.
      expect(await canSign(service, asset.originalPath)).toBe(false)
      expect(await objectsOf(asset)).toEqual([])
    })

    it("is idempotent", async () => {
      const asset = await readyAsset(staffA)
      expect((await remove(staffA.client, asset.id)).ok).toBe(true)
      expect(await remove(staffA.client, asset.id)).toEqual({
        ok: true,
        assetId: asset.id,
        storage: "removed",
      })
    })

    it("staff cannot remove another staff member's asset at the same venue (404, unchanged)", async () => {
      const asset = await readyAsset(staffB)
      const before = await row(asset.id)
      const result = await remove(staffA.client, asset.id)
      expect(result).toEqual({ ok: false, status: 404, error: "not_found" })
      expect(await row(asset.id)).toEqual(before)
      expect(await objectsOf(asset)).toEqual([
        "original.jpg",
        "preview.webp",
        "thumb.webp",
      ])
      expect(await visibleTo(staffB.client, asset.id)).toBe(true)
      expect(await visibleTo(admin.client, asset.id)).toBe(true)
    })

    it("answers 404 for unknown or malformed IDs and 401 without a session", async () => {
      const expected: RemoveMediaAssetResult = {
        ok: false,
        status: 404,
        error: "not_found",
      }
      expect(await remove(staffA.client, randomUUID())).toEqual(expected)
      expect(await remove(staffA.client, "not-a-uuid")).toEqual(expected)
      expect(await remove(admin.client, randomUUID())).toEqual(expected)

      const asset = await readyAsset(staffA)
      expect(await remove(anonClient(), asset.id)).toEqual({
        ok: false,
        status: 401,
        error: "unauthenticated",
      })
      expect((await row(asset.id)).deleted_at).toBeNull()
    })

    it("admin can remove any staff member's asset", async () => {
      const asset = await readyAsset(staffB)
      expect(await remove(admin.client, asset.id)).toEqual({
        ok: true,
        assetId: asset.id,
        storage: "removed",
      })
      expect(await visibleTo(staffB.client, asset.id)).toBe(false)
      expect(await visibleTo(admin.client, asset.id)).toBe(false)
      expect(await objectsOf(asset)).toEqual([])
    })

    it("admin can remove an asset that is still uploading", async () => {
      const asset = await reserve(staffB)
      expect((await remove(admin.client, asset.id)).ok).toBe(true)
      expect(await objectsOf(asset)).toEqual([])
    })
  })

  describe("runMediaCleanup", () => {
    it("retries a removal whose storage delete failed, on the next run", async () => {
      const asset = await readyAsset(staffA)

      // Physical delete fails: hidden and unsignable at once, bytes still stored.
      const result = await remove(staffA.client, asset.id, failingRemover)
      expect(result).toEqual({
        ok: true,
        assetId: asset.id,
        storage: "pending",
      })
      expect(await visibleTo(staffA.client, asset.id)).toBe(false)
      expect(await visibleTo(admin.client, asset.id)).toBe(false)
      expect(await canSign(admin.client, asset.originalPath)).toBe(false)
      expect(await objectsOf(asset)).toHaveLength(3)

      // The next cleanup run fails too; the asset is reported and kept pending.
      const failedRun = await runMediaCleanup(service, {
        removeObjects: failingRemover,
      })
      expect(failedRun.status).toBe("completed")
      if (failedRun.status !== "completed") return
      expect(failedRun.failed).toContainEqual({
        assetId: asset.id,
        error: "simulated storage outage",
      })
      expect(await objectsOf(asset)).toHaveLength(3)

      // Storage recovers: the following run removes everything.
      const run = await runMediaCleanup(service)
      expect(run.status).toBe("completed")
      if (run.status !== "completed") return
      expect(run.failed).toEqual([])
      expect(run.removed.byState.ready).toBeGreaterThanOrEqual(1)
      expect(await objectsOf(asset)).toEqual([])
    })

    it("cleans abandoned reservations and failed uploads, keeps active ones", async () => {
      // Abandoned 25 h ago, with a stored (partial) original.
      const abandoned = await reserve(staffA)
      age(abandoned.id, 25)
      // Abandoned before any bytes arrived.
      const empty = await reserve(staffA, false)
      age(empty.id, 25)
      // Failed processing 25 h ago, leftover original.
      const failed = await reserve(staffA)
      await service
        .from("media_assets")
        .update({ upload_state: "processing" })
        .eq("id", failed.id)
      await service
        .from("media_assets")
        .update({ upload_state: "failed" })
        .eq("id", failed.id)
      age(failed.id, 25)
      // Fresh reservation.
      const fresh = await reserve(staffA)
      // Old row but bytes written within the window: a transfer finished, finalise pending.
      const active = await reserve(staffA)
      age(active.id, 25, false)
      // Processing is owned by the processing path, never by cleanup.
      const processing = await reserve(staffA)
      await service
        .from("media_assets")
        .update({ upload_state: "processing" })
        .eq("id", processing.id)
      age(processing.id, 25)
      // A ready asset is never abandoned however old.
      const ready = await readyAsset(staffA)
      age(ready.id, 25)

      const run = await runMediaCleanup(service)
      expect(run.status).toBe("completed")
      if (run.status !== "completed") return
      expect(run.failed).toEqual([])
      expect(run.removed.byState.uploading).toBeGreaterThanOrEqual(1)
      expect(run.removed.byState.failed).toBeGreaterThanOrEqual(1)

      for (const gone of [abandoned, empty, failed]) {
        expect((await row(gone.id)).deleted_at).not.toBeNull()
        expect(await objectsOf(gone)).toEqual([])
        expect(await visibleTo(staffA.client, gone.id)).toBe(false)
      }
      for (const kept of [fresh, active, processing, ready]) {
        expect((await row(kept.id)).deleted_at).toBeNull()
        expect(await objectsOf(kept)).not.toEqual([])
      }
      expect((await row(fresh.id)).upload_state).toBe("uploading")
    })

    it("running cleanup twice is a no-op", async () => {
      const asset = await readyAsset(staffA)
      await remove(staffA.client, asset.id, failingRemover)

      const first = await runMediaCleanup(service)
      expect(first.status).toBe("completed")
      if (first.status !== "completed") return
      expect(first.removed.assets).toBeGreaterThanOrEqual(1)

      const snapshot = sql(
        "select count(*) filter (where deleted_at is null) || '/' || count(*) from public.media_assets"
      )
      const second = await runMediaCleanup(service)
      expect(second).toEqual({
        status: "completed",
        reaped: { assetIds: [], reason: "stale_processing" },
        removed: {
          assets: 0,
          objects: 0,
          byState: { uploading: 0, processing: 0, ready: 0, failed: 0 },
        },
        failed: [],
        more: false,
      })
      expect(
        sql(
          "select count(*) filter (where deleted_at is null) || '/' || count(*) from public.media_assets"
        )
      ).toBe(snapshot)
    })

    it("skips while another run holds the lease", async () => {
      const holder = "00000000-0000-0000-0000-000000000001"
      const held = await service.rpc("acquire_maintenance_lease", {
        p_name: CLEANUP_LEASE,
        p_holder: holder,
        p_ttl: "60 seconds",
      })
      expect(held.data).toBe(true)
      expect(await runMediaCleanup(service)).toEqual({
        status: "skipped",
        reason: "locked",
      })
      await service.rpc("release_maintenance_lease", {
        p_name: CLEANUP_LEASE,
        p_holder: holder,
      })
      expect((await runMediaCleanup(service)).status).toBe("completed")
    })

    it("concurrent runs: one works, the other skips, nothing is lost", async () => {
      const asset = await readyAsset(staffA)
      await remove(staffA.client, asset.id, failingRemover)

      let entered!: () => void
      const inRemoval = new Promise<void>((resolve) => (entered = resolve))
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const real = async (keys: string[]) => {
        entered()
        await gate
        const { error } = await media().remove(keys)
        if (error) throw error
      }

      const first = runMediaCleanup(service, { removeObjects: real })
      await inRemoval
      const second = await runMediaCleanup(service)
      release()
      expect(second).toEqual({ status: "skipped", reason: "locked" })
      const done = await first
      expect(done.status).toBe("completed")
      expect(await objectsOf(asset)).toEqual([])
    })

    it("refuses an abandoned window shorter than one hour", async () => {
      const { error } = await service.rpc("prepare_media_cleanup", {
        p_abandoned_after: "5 minutes",
      })
      expect(error?.message).toBe("abandoned_window_too_short")
    })

    it("end users cannot run cleanup or take the lease", async () => {
      for (const client of [staffA.client, admin.client]) {
        expect(
          (
            await client.rpc("prepare_media_cleanup", {
              p_abandoned_after: "24 hours",
            })
          ).error
        ).not.toBeNull()
        expect(
          (
            await client.rpc("acquire_maintenance_lease", {
              p_name: CLEANUP_LEASE,
              p_holder: randomUUID(),
              p_ttl: "60 seconds",
            })
          ).error
        ).not.toBeNull()
      }
    })
  })

  describe("deactivation", () => {
    it("keeps the portfolio for admins and blocks the deactivated staff member", async () => {
      const venue = await createVenue(service, "lc-deact")
      const leaver = await createIdentity(service, {
        label: "lc-leaver",
        role: "staff",
        venueId: venue.id,
      })
      const asset = await readyAsset(leaver)
      const pendingReservation = await reserve(leaver)

      const { error } = await admin.client
        .from("profiles")
        .update({ active: false })
        .eq("id", leaver.id)
      expect(error).toBeNull()

      // The staff member's existing session is denied.
      expect(await visibleTo(leaver.client, asset.id)).toBe(false)
      expect(await canSign(leaver.client, asset.originalPath)).toBe(false)
      expect(await remove(leaver.client, asset.id)).toEqual({
        ok: false,
        status: 403,
        error: "inactive",
      })

      // Nothing was deleted, and cleanup does not delete it either.
      await runMediaCleanup(service)
      expect((await row(asset.id)).deleted_at).toBeNull()
      expect((await row(pendingReservation.id)).deleted_at).toBeNull()
      expect(await objectsOf(asset)).toEqual([
        "original.jpg",
        "preview.webp",
        "thumb.webp",
      ])

      // Admins keep access to the retained portfolio.
      expect(await visibleTo(admin.client, asset.id)).toBe(true)
      // Through the app's authorised read path (wave 3 finding 1).
      const actor = await actorFor(admin)
      const found = await getReadableAsset(actor, asset.id)
      expect(found.ok).toBe(true)
      if (!found.ok) return
      const download = await streamOriginal(actor, found.asset, null)
      expect(download.status).toBe(200)
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(TINY_BYTES)
    })
  })

  describe("cleanup endpoint and script", () => {
    const saved = process.env.CLEANUP_SECRET
    const secret = randomUUID() + randomUUID()
    afterAll(() => {
      if (saved === undefined) delete process.env.CLEANUP_SECRET
      else process.env.CLEANUP_SECRET = saved
    })

    function post(auth?: string) {
      return new Request("http://localhost/api/internal/cleanup", {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
      })
    }

    it("POST only, and only with the shared secret", async () => {
      const route = await import("@/app/api/internal/cleanup/route")
      expect("GET" in route).toBe(false)

      delete process.env.CLEANUP_SECRET
      expect((await route.POST(post(`Bearer ${secret}`))).status).toBe(503)

      process.env.CLEANUP_SECRET = secret
      for (const auth of [
        undefined,
        "Bearer wrong",
        secret,
        `Bearer ${secret}x`,
        `Basic ${secret}`,
      ]) {
        const res = await route.POST(post(auth))
        expect(res.status).toBe(401)
        expect(res.headers.get("cache-control")).toBe("no-store")
      }

      const asset = await readyAsset(staffB)
      await remove(staffB.client, asset.id, failingRemover)
      const ok = await route.POST(post(`Bearer ${secret}`))
      expect(ok.status).toBe(200)
      expect(ok.headers.get("cache-control")).toBe("no-store")
      const report = await ok.json()
      expect(report.status).toBe("completed")
      expect(report.removed.assets).toBeGreaterThanOrEqual(1)
      expect(await objectsOf(asset)).toEqual([])
    })

    it("`pnpm cleanup` runs one pass and prints the report", async () => {
      const asset = await readyAsset(staffB)
      await remove(staffB.client, asset.id, failingRemover)
      const out = execFileSync(
        "node_modules/.bin/tsx",
        ["scripts/cleanup.ts"],
        {
          encoding: "utf8",
          env: process.env,
        }
      )
      const report = JSON.parse(out)
      expect(report.status).toBe("completed")
      expect(report.failed).toEqual([])
      expect(await objectsOf(asset)).toEqual([])
    })
  })

  describe("simulated clock", () => {
    // Last: a clock 25 h ahead treats every live reservation in the stack as abandoned.
    it("`now` moves the abandoned window", async () => {
      const asset = await reserve(staffA)
      const today = await runMediaCleanup(service)
      expect(today.status).toBe("completed")
      expect((await row(asset.id)).deleted_at).toBeNull()

      const tomorrow = await runMediaCleanup(service, {
        now: new Date(Date.now() + 25 * 3600 * 1000),
      })
      expect(tomorrow.status).toBe("completed")
      expect((await row(asset.id)).deleted_at).not.toBeNull()
      expect(await objectsOf(asset)).toEqual([])
    })
  })
})
