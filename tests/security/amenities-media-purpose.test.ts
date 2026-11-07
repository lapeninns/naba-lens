// Amenity evidence stays out of the organisation community (review finding
// M1, supabase/migrations/20261107130000_amenity_media_purpose.sql). An
// amenity-purpose upload, or any upload attached to an amenity submission, is
// not readable by colleagues at the same or another venue through
// community_readable_assets, community_media_page, the community_members count
// or the /api/media/[id]/* gate (getReadableAsset). The uploader and admins keep
// it; the venue manager reads it through amenity_evidence_asset. A general
// upload is unchanged, and so is legacy Coverage media (a Coverage submission
// item or amenity fact photo) a manager attached as evidence: Coverage review
// and configuration screens still read it. Coverage media is never hidden,
// whatever its purpose, but the Coverage pickers (coverage_candidate_assets) do
// not offer amenity-purpose uploads. A saved upload key never resumes under the
// other purpose (reservation_purpose_mismatch). A venue manager account
// (role 'manager') reads nothing from the community functions or the
// /api/media colleague path at all (20261107100200_manager_staff_denials.sql),
// so amenity evidence stays out of community for it too; the staff account
// with a pre-existing grant (transitional rule) reads like a colleague. Real
// signed-in identities; the service role only builds fixtures and reads state
// back.
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
import {
  fails,
  insertAsset,
  insertSubmittedItem,
  legacyStaffGrant,
  makeManager,
  ok,
} from "./coverage-fixtures"

const service = serviceClient()

let admin: TestIdentity
/** Venue manager account (role 'manager'). */
let manager: TestIdentity
/** Staff account with a pre-existing grant (transitional rule). */
let legacyManager: TestIdentity
let uploader: TestIdentity
let sameVenue: TestIdentity
let otherVenue: TestIdentity
/** A colleague whose Coverage photos the manager attaches as evidence. */
let coverageAuthor: TestIdentity
/** A colleague whose amenity-purpose photo ends up in Coverage. */
let amenityCoverageAuthor: TestIdentity

/** Amenity upload attached to a submission. */
let amenitySubmitted: string
/** Amenity upload never attached. */
let amenityLoose: string
let amenityLooseKey: string
/** General upload attached to the same submission. */
let generalSubmitted: string
/** General upload, not evidence. */
let general: string
let generalKey: string
/** Legacy Coverage submission photo, attached by the manager. */
let legacyItem: string
/** Legacy amenity fact photo, attached by the manager. */
let legacyFact: string
/** Amenity-purpose upload submitted to Coverage. */
let amenityInCoverage: string
let venue: string

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
  venue = (await createVenue(service, "amen-purpose")).id
  const elsewhere = (await createVenue(service, "amen-purpose-other")).id
  admin = await createIdentity(service, {
    label: "amen-purpose-admin",
    role: "admin",
  })
  const staff = (label: string, venueId: string) =>
    createIdentity(service, { label, role: "staff", venueId })
  manager = await staff("amen-purpose-mgr", venue)
  legacyManager = await staff("amen-purpose-legacy-mgr", venue)
  uploader = await staff("amen-purpose-uploader", venue)
  sameVenue = await staff("amen-purpose-same", venue)
  otherVenue = await staff("amen-purpose-other", elsewhere)
  coverageAuthor = await staff("amen-purpose-coverage", venue)
  amenityCoverageAuthor = await staff("amen-purpose-cov-amenity", venue)
  await makeManager(admin, manager, venue)
  await legacyStaffGrant(service, admin, legacyManager.id, venue)

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
  amenityLooseKey = randomUUID()
  amenityLoose = await readyAsset(uploader, "amenity", amenityLooseKey)
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

  // Legacy Coverage media for "outdoor_seating": one photo submitted to the
  // venue's Coverage requirement, one on its amenity fact. The manager attaches
  // both to a "covered_seating" check (same legacy key).
  const { data: req, error: reqError } = await service
    .from("coverage_requirements")
    .insert({
      venue_id: venue,
      kind: "amenity",
      title: "TEST Outdoor seating",
      amenity_key: "outdoor_seating",
      status: "active",
    })
    .select("id")
    .single()
  if (reqError) throw reqError
  const itemAsset = await insertAsset(service, {
    uploader: coverageAuthor.id,
    venue,
  })
  await insertSubmittedItem(service, {
    asset: itemAsset,
    venue,
    author: coverageAuthor.id,
    submittedAt: new Date().toISOString(),
    requirement: req!.id,
  })
  legacyItem = itemAsset.id
  const { data: fact, error: factError } = await service
    .from("venue_amenity_facts")
    .insert({ venue_id: venue, amenity_key: "outdoor_seating" })
    .select("id")
    .single()
  if (factError) throw factError
  legacyFact = (
    await insertAsset(service, { uploader: coverageAuthor.id, venue })
  ).id
  const factMedia = await service
    .from("venue_amenity_fact_media")
    .insert({ fact_id: fact!.id, venue_id: venue, asset_id: legacyFact })
  if (factMedia.error) throw factMedia.error

  const [coveredId] = await ok(
    manager.client.rpc("amenity_add_checks", {
      p_venue_id: venue,
      p_keys: ["covered_seating"],
    })
  )
  await ok(
    manager.client.rpc("amenity_submit_finding", {
      p_check_id: coveredId!,
      p_revision: await revisionOf(coveredId!),
      p_idempotency_key: randomUUID(),
      p_answer: "yes",
      p_finding: null as unknown as string,
      p_limitations: null as unknown as string,
      p_reason: null as unknown as string,
      p_asset_ids: [legacyItem, legacyFact],
      p_internal_metadata: null as never,
      p_redaction_confirmed: false,
    })
  )
  const { count } = await service
    .from("amenity_submission_assets")
    .select("asset_id", { count: "exact", head: true })
    .in("asset_id", [legacyItem, legacyFact])
  if (count !== 2) throw new Error("legacy evidence was not attached")

  // An amenity-purpose photo that is also a Coverage submission item.
  amenityInCoverage = await readyAsset(amenityCoverageAuthor, "amenity")
  const { data: inCoverage, error: inCoverageError } = await service
    .from("media_assets")
    .select("id, created_at")
    .eq("id", amenityInCoverage)
    .single()
  if (inCoverageError) throw inCoverageError
  await insertSubmittedItem(service, {
    asset: inCoverage!,
    venue,
    author: amenityCoverageAuthor.id,
    submittedAt: new Date().toISOString(),
    requirement: req!.id,
  })
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

  it("refuses a retry of the same key with the other purpose and changes nothing", async () => {
    const before = await service
      .from("media_assets")
      .select("*")
      .in("id", [general, amenityLoose])
      .order("id")
    expect(before.error).toBeNull()
    await fails(
      reserve(uploader, "amenity", generalKey),
      "reservation_purpose_mismatch",
      "22023"
    )
    // No p_purpose is general: refused for an amenity key too.
    await fails(
      reserve(uploader, undefined, amenityLooseKey),
      "reservation_purpose_mismatch",
      "22023"
    )
    await fails(
      reserve(uploader, "general", amenityLooseKey),
      "reservation_purpose_mismatch",
      "22023"
    )
    const after = await service
      .from("media_assets")
      .select("*")
      .in("id", [general, amenityLoose])
      .order("id")
    expect(after.data).toEqual(before.data)
  })

  it("replays a retry of the same key with the same purpose", async () => {
    for (const purpose of [undefined, "general"]) {
      const [retry] = await ok(reserve(uploader, purpose, generalKey))
      expect(retry).toMatchObject({ id: general, reused: true })
    }
    const [retry] = await ok(reserve(uploader, "amenity", amenityLooseKey))
    expect(retry).toMatchObject({ id: amenityLoose, reused: true })
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
    for (const who of [sameVenue, otherVenue, legacyManager]) {
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

  it("community_readable_assets: a general own upload is hidden once attached to a submission", async () => {
    for (const who of [sameVenue, otherVenue, legacyManager]) {
      expect(await readable(who, [generalSubmitted])).toEqual([])
    }
  })

  it("community_readable_assets: an amenity upload is hidden before it is submitted", async () => {
    for (const who of [sameVenue, otherVenue, legacyManager]) {
      expect(await readable(who, [amenityLoose])).toEqual([])
    }
  })

  it("a manager account reads nothing: no amenity evidence, no general or Coverage media", async () => {
    const everything = [...all(), legacyItem, legacyFact, amenityInCoverage]
    expect(await readable(manager, everything)).toEqual([])
    expect(await feed(manager)).toEqual([])
    expect(
      await ok(
        manager.client.rpc("community_members", { p_member: uploader.id })
      )
    ).toEqual([])
    for (const id of everything) expect(await mediaGate(manager, id)).toBe(404)
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

describe("legacy Coverage media attached as amenity evidence", () => {
  const legacy = () => [legacyFact, legacyItem].sort()

  it("community_readable_assets: still readable by same-org colleagues, as before", async () => {
    for (const who of [sameVenue, otherVenue, legacyManager, uploader]) {
      expect(await readable(who, legacy())).toEqual(legacy())
    }
  })

  it("stays in the community feed and the author's media count", async () => {
    for (const who of [sameVenue, otherVenue]) {
      const page = (
        await ok(
          who.client.rpc("community_media_page", {
            p_uploader: coverageAuthor.id,
            p_limit: 100,
          })
        )
      ).map((r: { id: string }) => r.id)
      expect([...page].sort()).toEqual(legacy())
      const [member] = await ok(
        who.client.rpc("community_members", {
          p_member: coverageAuthor.id,
          p_limit: 1,
        })
      )
      expect(Number(member!.media_count)).toBe(2)
    }
  })

  it("is served by the /api/media gate to colleagues", async () => {
    for (const who of [sameVenue, otherVenue]) {
      for (const id of legacy()) expect(await mediaGate(who, id)).toBe(200)
    }
  })
})

describe("amenity-purpose photo used as Coverage media", () => {
  it("community_readable_assets: stays readable to the transitional staff manager and colleagues", async () => {
    for (const who of [
      legacyManager,
      sameVenue,
      admin,
      amenityCoverageAuthor,
    ]) {
      expect(await readable(who, [amenityInCoverage])).toEqual([
        amenityInCoverage,
      ])
    }
  })

  it("is served by the /api/media gate to the transitional staff manager", async () => {
    expect(await mediaGate(legacyManager, amenityInCoverage)).toBe(200)
  })
})

describe("coverage_candidate_assets", () => {
  const candidates = async (who: TestIdentity) =>
    (
      await ok(
        who.client.rpc("coverage_candidate_assets", {
          p_venue_id: venue,
          p_limit: 101,
        })
      )
    ).map((r: { asset_id: string }) => r.asset_id)

  it("lists general uploads but never amenity-purpose ones", async () => {
    for (const who of [manager, admin]) {
      const ids = await candidates(who)
      expect(ids).toContain(general)
      expect(ids).toContain(legacyItem)
      for (const id of [amenitySubmitted, amenityLoose, amenityInCoverage]) {
        expect(ids).not.toContain(id)
      }
    }
  })

  it("leaves amenity-purpose uploads out of the uploader's own picker", async () => {
    const ids = (
      await ok(uploader.client.rpc("coverage_candidate_assets", {}))
    ).map((r: { asset_id: string }) => r.asset_id)
    expect(ids).toContain(general)
    expect(ids).not.toContain(amenitySubmitted)
    expect(ids).not.toContain(amenityLoose)
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
  it("the venue managers and admins read submitted evidence through amenity_evidence_asset", async () => {
    for (const who of [manager, legacyManager, admin]) {
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
