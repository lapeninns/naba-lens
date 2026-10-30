// Wave 3 review findings 3 and 6 (docs/reviews/wave3-review.md): a finalise that
// dies after its claim must not leave an asset in `processing` forever, and
// stale-claim decisions use the database clock only.
import { execFileSync } from "node:child_process"

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { MEDIA_LIMITS } from "@/lib/config/media"
import { runMediaCleanup } from "@/lib/server/lifecycle/cleanup"
import { finaliseAsset } from "@/lib/server/media/finalise"
import { actorFor, syntheticJpeg } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

const service = serviceClient()

/** psql against the isolated stack (same guard as lifecycle.test.ts). */
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

/** Moves the claim stamp `minutes` into the past, bypassing the updated_at trigger. */
function ageClaim(assetId: string, minutes: number) {
  sql(
    `set session_replication_role = replica; update public.media_assets set updated_at = now() - interval '${minutes} minutes' where id = '${assetId}'`
  )
}

async function row(id: string) {
  const { data, error } = await service
    .from("media_assets")
    .select("upload_state, deleted_at, updated_at")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

let staff: TestIdentity

/** A reserved asset with a real JPEG stored, claimed by a finalise (`processing`). */
async function claimedAsset(user = staff) {
  const { data, error } = await user.client.rpc("reserve_media_asset", {
    p_media_type: "image",
    p_extension: "jpg",
    p_original_filename: "stale.jpg",
  })
  if (error) throw error
  const asset = data[0]
  const put = await user.client.storage
    .from("media")
    .upload(asset.original_path, await syntheticJpeg(64, 48), {
      contentType: "image/jpeg",
    })
  if (put.error) throw put.error
  const claim = await service
    .from("media_assets")
    .update({ upload_state: "processing" })
    .eq("id", asset.id)
  if (claim.error) throw claim.error
  return asset
}

async function objectStored(path: string) {
  const dir = path.slice(0, path.lastIndexOf("/"))
  const { data, error } = await service.storage.from("media").list(dir)
  if (error) throw error
  return (data ?? []).some((o) => o.name === "original.jpg")
}

beforeAll(async () => {
  const venue = (await createVenue(service, "stale")).id
  staff = await createIdentity(service, {
    label: "stale-staff",
    role: "staff",
    venueId: venue,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("finding 3: cleanup reaps crashed finalise claims", () => {
  it("a claim older than the window becomes failed, bytes kept; fresher claims are untouched", async () => {
    const window = MEDIA_LIMITS.staleProcessingMinutes
    const crashed = await claimedAsset()
    const inFlight = await claimedAsset()
    const nearly = await claimedAsset()
    const tombstoned = await claimedAsset()
    ageClaim(crashed.id, window + 1)
    ageClaim(inFlight.id, 3)
    ageClaim(nearly.id, window - 1)
    const del = await staff.client.rpc("delete_media_asset", {
      p_asset_id: tombstoned.id,
    })
    expect(del.error).toBeNull()
    ageClaim(tombstoned.id, window + 1)
    const nearlyStamp = (await row(nearly.id)).updated_at

    const report = await runMediaCleanup(service)
    expect(report.status).toBe("completed")
    if (report.status !== "completed") return
    expect(report.reaped.reason).toBe("stale_processing")
    expect(report.reaped.assetIds).toContain(crashed.id)
    for (const id of [inFlight.id, nearly.id, tombstoned.id])
      expect(report.reaped.assetIds).not.toContain(id)

    expect(await row(crashed.id)).toMatchObject({
      upload_state: "failed",
      deleted_at: null,
    })
    // The failed row's 24 h abandoned window starts now, not at the old claim.
    expect(
      Date.now() - Date.parse((await row(crashed.id)).updated_at)
    ).toBeLessThan(5 * 60_000)
    expect(await objectStored(crashed.original_path)).toBe(true)
    expect(await row(inFlight.id)).toMatchObject({ upload_state: "processing" })
    expect(await row(nearly.id)).toEqual({
      upload_state: "processing",
      deleted_at: null,
      updated_at: nearlyStamp,
    })
  })

  it("the uploader can retry a reaped asset to ready", async () => {
    const asset = await claimedAsset()
    ageClaim(asset.id, MEDIA_LIMITS.staleProcessingMinutes + 5)
    const report = await runMediaCleanup(service)
    expect(report.status === "completed" && report.reaped.assetIds).toContain(
      asset.id
    )
    // The staff gallery reads this through RLS: a real failure, not "Processing".
    const own = await staff.client
      .from("media_assets")
      .select("upload_state")
      .eq("id", asset.id)
      .single()
    expect(own.data?.upload_state).toBe("failed")

    const result = await finaliseAsset(await actorFor(staff), {
      assetId: asset.id,
      idempotencyKey: "unused-for-keyless",
    })
    expect(result).toEqual({ ok: true, state: "ready" })
  })

  it("the reaper refuses windows short enough to catch a running finalise", async () => {
    const { error } = await service.rpc("fail_stale_media_processing", {
      p_stale_after: "5 minutes",
    })
    expect(error?.message).toBe("stale_window_too_short")
  })
})

describe("finding 6: stale-claim takeover uses database time only", () => {
  it("take_over_stale_media_claim compares the claim stamp with the database clock", async () => {
    const asset = await claimedAsset()
    const fresh = await service.rpc("take_over_stale_media_claim", {
      p_asset_id: asset.id,
      p_stale_after: "2 minutes",
    })
    expect(fresh).toMatchObject({ data: false, error: null })
    ageClaim(asset.id, 3)
    const stale = await service.rpc("take_over_stale_media_claim", {
      p_asset_id: asset.id,
      p_stale_after: "2 minutes",
    })
    expect(stale).toMatchObject({ data: true, error: null })
    expect((await row(asset.id)).upload_state).toBe("failed")
    // Compare-and-set: a second caller gets false.
    const again = await service.rpc("take_over_stale_media_claim", {
      p_asset_id: asset.id,
      p_stale_after: "2 minutes",
    })
    expect(again.data).toBe(false)
  })

  it("an app host clock an hour ahead does not take over a live claim", async () => {
    const asset = await claimedAsset()
    const before = await row(asset.id)
    const realNow = Date.now.bind(Date)
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 3_600_000)

    const result = await finaliseAsset(await actorFor(staff), {
      assetId: asset.id,
      idempotencyKey: "unused-for-keyless",
    })
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(await row(asset.id)).toEqual(before)
  }, 45_000)

  it("finalise takes over a claim that is stale by database time and completes it", async () => {
    const asset = await claimedAsset()
    ageClaim(asset.id, 3)
    const result = await finaliseAsset(await actorFor(staff), {
      assetId: asset.id,
      idempotencyKey: "unused-for-keyless",
    })
    expect(result).toEqual({ ok: true, state: "ready" })
  })
})
