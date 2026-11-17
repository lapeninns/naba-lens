// Album AL-7 (docs/plans/album-a3-a5.md, A5): staff at a venue see the
// current photo of its accepted or waiting area slots and its accepted
// amenity slots (review never gates visibility). public.album_slot_photos
// lists them; public.album_slot_asset is the gate before a thumbnail is
// signed. Real signed-in identities through PostgREST; the service role and
// psql only build fixtures.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  type TestIdentity,
} from "../support/identities"
import { legacyStaffGrant, ok, psql } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  call,
  decide,
  json,
  londonToday,
  service,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"
import { reserveReady } from "./menus-fixtures"

type SlotPhotos = {
  venueId: string
  items: Array<{ kind: "area" | "amenity"; slotId: string; assetId: string }>
}

const photos = (who: TestIdentity, venue?: string) =>
  json<SlotPhotos>(who, "album_slot_photos", venue ? { p_venue_id: venue } : {})

async function gate(who: { client: unknown }, asset: string) {
  const { data, error } = await call(who, "album_slot_asset", {
    p_asset_id: asset,
  })
  if (error) throw new Error(`${error.code} ${error.message}`)
  return (data as Array<{ asset_id: string; venue_id: string }>) ?? []
}

const setArea = (who: TestIdentity, asset: string, subject: string) =>
  ok(
    who.client.rpc("set_media_area_label", {
      p_asset_id: asset,
      p_subject_id: subject,
    })
  )

const decideArea = (
  who: TestIdentity,
  label: string,
  action: "accepted" | "needs_another_photo" | "withdrawn",
  reason?: string
) =>
  ok(
    who.client.rpc("decide_area_photo", {
      p_label_id: label,
      p_action: action,
      ...(reason ? { p_reason: reason } : {}),
    })
  )

function place(venue: string, adminId: string, label: string) {
  return psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${venue}', 'area', '${label}', '${adminId}') returning id`
  )
}

/** A ready photo by `who`, labelled with `subject`. */
async function areaPhoto(who: TestIdentity, subject: string) {
  const asset = (await reserveReady(service, who)).id
  const [row] = (await setArea(who, asset, subject))!
  return { asset, label: row!.label_id! }
}

type Venue = {
  w: World
  /** A legacy-grant manager who decides area photos. */
  reviewer: TestIdentity
  places: { bar: string; garden: string; snug: string; cellar: string }
}

async function venue(label: string): Promise<Venue> {
  const w = await world(label)
  const a = w.admin
  const reviewer = await createIdentity(service, {
    label: `${label}-rev`,
    role: "staff",
    venueId: w.venue,
  })
  await legacyStaffGrant(service, a, reviewer.id, w.venue)
  return {
    w,
    reviewer,
    places: {
      bar: place(w.venue, a.id, "Bar"),
      garden: place(w.venue, a.id, "Garden"),
      snug: place(w.venue, a.id, "Snug"),
      cellar: place(w.venue, a.id, "Cellar"),
    },
  }
}

let v: Venue
let other: Venue
const shown: Record<string, string> = {}
const hidden: Record<string, string> = {}

beforeAll(async () => {
  await knowledgeAdmin()
  ;[v, other] = await Promise.all([venue("album-al7"), venue("album-al7-o")])
  const { w, reviewer, places } = v

  // Areas: accepted (bar), waiting (garden), retake (snug), withdrawn (cellar).
  const bar = await areaPhoto(w.staffA, places.bar)
  await decideArea(reviewer, bar.label, "accepted")
  shown.areaAccepted = bar.asset
  const garden = await areaPhoto(w.staffA, places.garden)
  shown.areaWaiting = garden.asset
  const snug = await areaPhoto(w.staffA, places.snug)
  await decideArea(reviewer, snug.label, "needs_another_photo", "Too dark")
  hidden.areaRetake = snug.asset
  const cellar = await areaPhoto(w.staffA, places.cellar)
  await decideArea(reviewer, cellar.label, "accepted")
  await decideArea(reviewer, cellar.label, "withdrawn", "Not the cellar")
  hidden.areaWithdrawn = cellar.asset

  // Amenities: an accepted Yes (onsite_parking) and a No (guest_toilets).
  const parking = await yes(w.staffA, w, "onsite_parking")
  expect(parking.outcome).toBe("current")
  shown.amenity = psql(
    `select sa.asset_id from public.amenity_submission_assets sa
     where sa.submission_id = '${parking.submissionId}' limit 1`
  )

  // The other venue: one accepted area photo.
  const theirs = await areaPhoto(other.w.staffA, other.places.bar)
  await decideArea(other.reviewer, theirs.label, "accepted")
  hidden.otherVenue = theirs.asset
})

describe("album_slot_photos", () => {
  it("lists the accepted and waiting area photos and the accepted amenity photo", async () => {
    const read = await photos(v.w.staffB)
    expect(read.venueId).toBe(v.w.venue)
    const byAsset = new Map(read.items.map((i) => [i.assetId, i]))
    expect(byAsset.get(shown.areaAccepted!)).toEqual({
      kind: "area",
      slotId: v.places.bar,
      assetId: shown.areaAccepted,
    })
    expect(byAsset.get(shown.areaWaiting!)).toMatchObject({
      kind: "area",
      slotId: v.places.garden,
    })
    expect(byAsset.get(shown.amenity!)).toEqual({
      kind: "amenity",
      slotId: v.w.checks.onsite_parking,
      assetId: shown.amenity,
    })
    for (const asset of Object.values(hidden))
      expect(byAsset.has(asset)).toBe(false)
    expect(read.items).toHaveLength(3)
  })

  it("is the same for the venue's manager and for an admin naming it", async () => {
    const mine = await photos(v.w.staffB)
    expect(await photos(v.w.manager)).toEqual(mine)
    expect(await photos(v.w.admin, v.w.venue)).toEqual(mine)
  })

  it("refuses another venue, and anon", async () => {
    const { error } = await call(v.w.staffA, "album_slot_photos", {
      p_venue_id: other.w.venue,
    })
    expect(error?.message).toBe("wrong_venue")
    const anon = await anonClient().rpc("album_slot_photos", {})
    expect(anon.error).not.toBeNull()
    expect(anon.data).toBeNull()
  })
})

describe("album_slot_asset", () => {
  it("lets every colleague at the venue, its manager and an admin open a shown photo", async () => {
    for (const asset of Object.values(shown)) {
      for (const who of [v.w.staffB, v.w.staffA, v.w.manager, v.w.admin]) {
        const rows = await gate(who, asset)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ asset_id: asset, venue_id: v.w.venue })
      }
    }
  })

  it("returns nothing for a retake, a withdrawn or an unknown photo", async () => {
    for (const asset of [
      hidden.areaRetake!,
      hidden.areaWithdrawn!,
      crypto.randomUUID(),
    ])
      expect(await gate(v.w.staffB, asset)).toEqual([])
  })

  it("returns nothing to staff or a manager of another venue", async () => {
    expect(await gate(v.w.staffB, hidden.otherVenue!)).toEqual([])
    expect(await gate(v.w.manager, hidden.otherVenue!)).toEqual([])
    expect(await gate(other.w.staffB, shown.areaAccepted!)).toEqual([])
    expect(await gate(other.w.staffB, shown.amenity!)).toEqual([])
    // A person moved to another venue loses their old venue's photos.
    const mover = await createIdentity(service, {
      label: "album-al7-mover",
      role: "staff",
      venueId: v.w.venue,
    })
    expect(await gate(mover, shown.areaWaiting!)).toHaveLength(1)
    const elsewhere = await createVenue(service, "album-al7-elsewhere")
    await ok(
      service
        .from("profiles")
        .update({ venue_id: elsewhere.id })
        .eq("id", mover.id)
    )
    expect(await gate(mover, shown.areaWaiting!)).toEqual([])
  })

  it("returns nothing for a deleted photo, and anon cannot call it", async () => {
    const extra = await areaPhoto(v.w.staffA, v.places.bar)
    await decideArea(v.reviewer, extra.label, "accepted")
    expect(await gate(v.w.staffB, extra.asset)).toHaveLength(1)
    await ok(
      service
        .from("media_assets")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", extra.asset)
    )
    expect(await gate(v.w.staffB, extra.asset)).toEqual([])
    // The older accepted photo is shown again.
    expect(await gate(v.w.staffB, shown.areaAccepted!)).toHaveLength(1)

    const anon = await anonClient().rpc("album_slot_asset", {
      p_asset_id: shown.areaAccepted!,
    })
    expect(anon.error).not.toBeNull()
    expect(anon.data).toBeNull()
  })

  it("gives the private row source no grant", () => {
    expect(
      psql(
        `select has_function_privilege('authenticated', 'private.album_slot_photo_rows(uuid)', 'execute')::text
           || ',' || has_function_privilege('anon', 'public.album_slot_asset(uuid)', 'execute')::text
           || ',' || has_function_privilege('anon', 'public.album_slot_photos(uuid)', 'execute')::text`
      )
    ).toBe("false,false,false")
  })
})

describe("an amenity whose service has ended", () => {
  // The app reads a Yes as No once its service end is in effect (answerInUse,
  // B03 A40), so the slot is Not here; the photo is no longer shown either.
  it("is not listed and its photo is not opened", async () => {
    const w = await world("album-al7-ended")
    const sent = await yes(w.staffA, w, "guest_toilets")
    if (sent.outcome === "awaiting_confirmation")
      expect(
        (
          await decide(
            w.manager,
            w,
            "guest_toilets",
            { type: "contribution", id: sent.contributionId },
            "confirm"
          )
        ).error
      ).toBeNull()
    const asset = psql(
      `select sa.asset_id from public.amenity_submission_assets sa
       join public.venue_amenity_checks c on c.current_submission_id = sa.submission_id
       where c.id = '${w.checks.guest_toilets}' limit 1`
    )
    const listed = async () =>
      (await photos(w.staffB)).items.some((i) => i.assetId === asset)
    expect(await listed()).toBe(true)
    expect(await gate(w.staffB, asset)).toHaveLength(1)

    // A stop from two days ago, attached as the B03 A40 suite does.
    const twoDaysAgo = new Date(
      Date.parse(`${londonToday()}T00:00:00Z`) - 2 * 86_400_000
    )
      .toISOString()
      .slice(0, 10)
    psql(`insert into public.knowledge_contribution_details
        (contribution_id, venue_id, question_version, value_schema, value_schema_version, detail, request_hash)
      select x.id, x.venue_id, 1, 'service', 1, '{"lastDayOffered": "${twoDaysAgo}"}'::jsonb,
        encode(sha256(x.id::text::bytea), 'hex')
      from public.knowledge_contributions x where x.id = '${sent.contributionId}'`)
    expect(
      psql(
        `select (private.knowledge_check_service_end('${w.checks.guest_toilets}', now()) ->> 'inEffect')`
      )
    ).toBe("true")
    expect(await listed()).toBe(false)
    expect(await gate(w.staffB, asset)).toEqual([])
  })
})
