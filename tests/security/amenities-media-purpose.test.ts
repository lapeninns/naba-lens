// Amenity evidence stays out of the organisation community (review finding
// M1, supabase/migrations/20261107130000_amenity_media_purpose.sql). An
// amenity-purpose upload, or any upload attached to an amenity submission, is
// not readable by colleagues at the same or another venue through
// community_readable_assets, community_media_page, the community_members count
// or the /api/media/[id]/* gate (getReadableAsset). The uploader and admins keep
// it; the venue manager reads it through amenity_evidence_asset. A general
// upload is unchanged. Real signed-in identities; the service role only builds
// fixtures and reads state back.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { getReadableAsset } from "../../lib/server/media/access"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { fails, grantManager, ok } from "./coverage-fixtures"

const service = serviceClient()

let admin: TestIdentity
let manager: TestIdentity
let uploader: TestIdentity
let sameVenue: TestIdentity
let otherVenue: TestIdentity

/** Amenity upload attached to a submission. */
let amenitySubmitted: string
/** Amenity upload never attached. */
let amenityLoose: string
/** General upload attached to the same submission. */
let generalSubmitted: string
/** General upload, not evidence. */
let general: string
let generalKey: string

function reserve(
  who: TestIdentity,
  purpose?: string,
  key: string = randomUUID()
) {
  return who.client.rpc("reserve_media_asset", {
    p_client_upload_key: key,
    p_size_bytes: 4,
    p_media_type: "image",
    p_extension: "jpg",
    p_original_filename: "TEST purpose.jpg",
    ...(purpose === undefined ? {} : { p_purpose: purpose }),
  })
}

async function readyAsset(
  who: TestIdentity,
  purpose?: string,
  key?: string
): Promise<string> {
  const [row] = await ok(reserve(who, purpose, key))
  await markReady(service, row!.id)
  return row!.id
}

async function revisionOf(checkId: string): Promise<number> {
  const { data, error } = await service
    .from("venue_amenity_checks")
    .select("revision")
    .eq("id", checkId)
    .single()
  if (error) throw error
  return data!.revision
}

const readable = async (who: TestIdentity, ids: string[]) =>
  (
    await ok(who.client.rpc("community_readable_assets", { p_asset_ids: ids }))
  ).map((r: { id: string }) => r.id)

const feed = async (who: TestIdentity) =>
  (
    await ok(
      who.client.rpc("community_media_page", {
        p_uploader: uploader.id,
        p_limit: 100,
      })
    )
  ).map((r: { id: string }) => r.id)

async function mediaGate(who: TestIdentity, assetId: string) {
  const result = await getReadableAsset(await actorFor(who), assetId)
  return result.ok ? 200 : result.status
}

const evidenceGate = async (who: TestIdentity, assetId: string) =>
  ok(who.client.rpc("amenity_evidence_asset", { p_asset_id: assetId }))

beforeAll(async () => {
  const venue = (await createVenue(service, "amen-purpose")).id
  const elsewhere = (await createVenue(service, "amen-purpose-other")).id
  admin = await createIdentity(service, {
    label: "amen-purpose-admin",
    role: "admin",
  })
  const staff = (label: string, venueId: string) =>
    createIdentity(service, { label, role: "staff", venueId })
  manager = await staff("amen-purpose-mgr", venue)
  uploader = await staff("amen-purpose-uploader", venue)
  sameVenue = await staff("amen-purpose-same", venue)
  otherVenue = await staff("amen-purpose-other", elsewhere)
  await grantManager(admin, manager.id, venue)

  await ok(admin.client.rpc("amenity_enable_venue", { p_venue_id: venue }))
  const [checkId] = await ok(
    manager.client.rpc("amenity_add_checks", {
      p_venue_id: venue,
      p_keys: ["outdoor_seating"],
    })
  )
  await ok(
    manager.client.rpc("amenity_assign_check", {
      p_check_id: checkId!,
      p_assignee_id: uploader.id,
      p_revision: await revisionOf(checkId!),
    })
  )

  amenitySubmitted = await readyAsset(uploader, "amenity")
  amenityLoose = await readyAsset(uploader, "amenity")
  generalSubmitted = await readyAsset(uploader, "general")
  generalKey = randomUUID()
  // Called as before this change: no p_purpose.
  general = await readyAsset(uploader, undefined, generalKey)

  await ok(
    uploader.client.rpc("amenity_submit_finding", {
      p_check_id: checkId!,
      p_revision: await revisionOf(checkId!),
      p_idempotency_key: randomUUID(),
      p_answer: "yes",
      p_finding: null as unknown as string,
      p_limitations: null as unknown as string,
      p_reason: null as unknown as string,
      p_asset_ids: [amenitySubmitted, generalSubmitted],
      p_internal_metadata: null as never,
      p_redaction_confirmed: false,
    })
  )
})

describe("media_assets.purpose", () => {
  it("is stored at reservation, general by default", async () => {
    const { data, error } = await service
      .from("media_assets")
      .select("id, purpose")
      .in("id", [amenitySubmitted, amenityLoose, generalSubmitted, general])
    expect(error).toBeNull()
    const byId = new Map(
      (data ?? []).map((r: { id: string; purpose: string }) => [
        r.id,
        r.purpose,
      ])
    )
    expect(byId.get(amenitySubmitted)).toBe("amenity")
    expect(byId.get(amenityLoose)).toBe("amenity")
    expect(byId.get(generalSubmitted)).toBe("general")
    expect(byId.get(general)).toBe("general")
  })

  it("rejects an unknown purpose", async () => {
    await fails(reserve(uploader, "community"), "invalid_purpose", "22023")
    await fails(reserve(uploader, null as never), "invalid_purpose", "22023")
  })

  it("keeps the first reservation's purpose on a retry of the same key", async () => {
    const [retry] = await ok(reserve(uploader, "amenity", generalKey))
    expect(retry).toMatchObject({ id: general, reused: true })
    const { data } = await service
      .from("media_assets")
      .select("purpose")
      .eq("id", general)
      .single()
    expect(data!.purpose).toBe("general")
  })

  it("cannot be changed after insert, even by the service role", async () => {
    for (const [id, to] of [
      [amenityLoose, "general"],
      [general, "amenity"],
    ] as const) {
      const { error } = await service
        .from("media_assets")
        .update({ purpose: to })
        .eq("id", id)
      expect(error?.code).toBe("42501")
      expect(error?.message).toBe("media_asset_reservation_immutable")
    }
    const { error } = await service
      .from("media_assets")
      .update({ purpose: "other" } as never)
      .eq("id", general)
    expect(error).not.toBeNull()
  })

  it("is not writable by the uploader", async () => {
    await uploader.client
      .from("media_assets")
      .update({ purpose: "general" })
      .eq("id", amenityLoose)
    const { data } = await service
      .from("media_assets")
      .select("purpose")
      .eq("id", amenityLoose)
      .single()
    expect(data!.purpose).toBe("amenity")
  })
})

describe("community reads", () => {
  const all = () => [amenitySubmitted, amenityLoose, generalSubmitted, general]

  it("community_readable_assets: colleagues at the same and another venue get only the general asset", async () => {
    for (const who of [sameVenue, otherVenue, manager]) {
      expect(await readable(who, all())).toEqual([general])
    }
  })

  it("community_readable_assets: the uploader and admins still get every asset", async () => {
    for (const who of [uploader, admin]) {
      expect((await readable(who, all())).sort()).toEqual([...all()].sort())
    }
  })

  it("community_media_page leaves amenity evidence out of the feed for everyone", async () => {
    for (const who of [sameVenue, otherVenue, uploader, admin]) {
      expect(await feed(who)).toEqual([general])
    }
  })

  it("community_members counts only community-visible media", async () => {
    for (const who of [sameVenue, otherVenue]) {
      const [member] = await ok(
        who.client.rpc("community_members", {
          p_member: uploader.id,
          p_limit: 1,
        })
      )
      expect(Number(member!.media_count)).toBe(1)
    }
  })
})

describe("/api/media/[id]/* gate (getReadableAsset)", () => {
  it("is 404 for a colleague on amenity evidence, 200 on the general asset", async () => {
    for (const who of [sameVenue, otherVenue]) {
      for (const id of [amenitySubmitted, amenityLoose, generalSubmitted]) {
        expect(await mediaGate(who, id)).toBe(404)
      }
      expect(await mediaGate(who, general)).toBe(200)
    }
  })

  it("still serves the uploader and admins", async () => {
    for (const who of [uploader, admin]) {
      for (const id of [
        amenitySubmitted,
        amenityLoose,
        generalSubmitted,
        general,
      ]) {
        expect(await mediaGate(who, id)).toBe(200)
      }
    }
  })
})

describe("amenity routes", () => {
  it("the venue manager and admins read submitted evidence through amenity_evidence_asset", async () => {
    for (const who of [manager, admin]) {
      for (const id of [amenitySubmitted, generalSubmitted]) {
        expect(await evidenceGate(who, id)).toHaveLength(1)
      }
    }
  })

  it("colleagues get nothing from amenity_evidence_asset", async () => {
    for (const who of [sameVenue, otherVenue]) {
      for (const id of [amenitySubmitted, amenityLoose, generalSubmitted]) {
        expect(await evidenceGate(who, id)).toEqual([])
      }
    }
  })
})
