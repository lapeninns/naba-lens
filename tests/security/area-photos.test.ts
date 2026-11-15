// G-9 (docs/plans/goals-not-tasks.md, phase 3): month credit for labelled
// venue areas. The uploader labels a still image with one of the venue's
// places; a venue manager or an admin accepts it or asks for another photo;
// an accepted area photo counts once toward the month its upload started.
// Real signed-in identities through PostgREST; the service role only builds
// fixtures and reads state back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  currentMonth,
  fails,
  insertAsset,
  legacyStaffGrant,
  makeManager,
  midMonth,
  monthOffset,
  ok,
  psql,
  review as reviewSend,
  staffProgress,
  submit,
} from "./coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

const service = serviceClient()

const setArea = (who: TestIdentity, asset: string, subject: string | null) =>
  who.client.rpc("set_media_area_label", {
    p_asset_id: asset,
    // Null clears; the generator types every SQL argument non-null.
    p_subject_id: subject as string,
  })
const decide = (
  who: TestIdentity,
  label: string,
  action: "accepted" | "needs_another_photo" | "withdrawn",
  reason: string | null = null
) =>
  who.client.rpc("decide_area_photo", {
    p_label_id: label,
    p_action: action,
    ...(reason === null ? {} : { p_reason: reason }),
  })
const queue = (who: TestIdentity, venue: string | null, status = "pending") =>
  who.client.rpc("area_photo_queue", {
    ...(venue === null ? {} : { p_venue_id: venue }),
    p_status: status,
  })
const mine = (who: TestIdentity, assets: string[]) =>
  who.client.rpc("my_area_labels", { p_asset_ids: assets })
const monthPhotos = (who: TestIdentity, month = currentMonth()) =>
  who.client.rpc("my_month_photos", {
    p_period_month: month,
    p_limit: 201,
  })

let admin: TestIdentity

type Fixture = {
  venue: string
  version: string
  manager: TestIdentity
  places: { bar: string; garden: string; toilets: string; retired: string }
  items: Record<string, CatalogueRow>
}

/** A place written as B03 does (psql: knowledge_subjects has no table grants). */
function place(venue: string, kind: string, label: string, retired = false) {
  return psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by${retired ? ", retired_at, retired_by, retire_reason" : ""})
     values ('${venue}', '${kind}', '${label}', '${admin.id}'${retired ? `, now(), '${admin.id}', 'TEST retired'` : ""})
     returning id`
  )
}

async function venueWithPlaces(label: string): Promise<Fixture> {
  const venue = (await createVenue(service, label)).id
  const manager = await createIdentity(service, {
    label: `${label}-mgr`,
    role: "staff",
    venueId: venue,
  })
  await legacyStaffGrant(service, admin, manager.id, venue)
  const version = await publishMenu(
    admin,
    venue,
    menu("TEST Area menu", [
      section("mains", "Mains", [item("mains--tikka", "Tikka")]),
    ])
  )
  const items = (await readDocument(service, version)).byKey
  const [bar, garden, toilets, retired] = await Promise.all([
    place(venue, "area", "Bar"),
    place(venue, "area", "Garden"),
    place(venue, "facility_point", "Toilets"),
    place(venue, "room", "Old snug", true),
  ])
  return {
    venue,
    version,
    manager,
    places: { bar, garden, toilets, retired },
    items,
  }
}

/** Rows of the G-9 tables (no PostgREST grants: read with psql as JSON). */
const rows = (sql: string): unknown[] =>
  JSON.parse(psql(`select coalesce(json_agg(t), '[]') from (${sql}) t`))

const newStaff = (label: string, venueId: string) =>
  createIdentity(service, { label, role: "staff", venueId })

/** A ready photo by `who`, labelled with `subject`; its label id. */
async function areaPhoto(who: TestIdentity, subject: string) {
  const asset = (await reserveReady(service, who)).id
  const [row] = (await ok(setArea(who, asset, subject)))!
  return { asset, label: row!.label_id! }
}

/** The person's own month counts at `venue`, checked against their list. */
async function month(
  who: TestIdentity,
  venue: string,
  period = currentMonth()
) {
  const rows = await staffProgress(who, null, period, who.id)
  const list = (await ok(monthPhotos(who, period)))!
  const row = rows.find((r) => r.venue_id === venue)
  const here = list.filter((p) => p.venue_id === venue)
  const n = (s: string) => here.filter((p) => p.state === s).length
  expect({
    accepted: n("accepted"),
    waiting: n("waiting"),
    needs: n("needs_another_photo"),
  }).toEqual({
    accepted: row?.accepted_count ?? 0,
    waiting: row?.pending_count ?? 0,
    needs: row?.needs_another_photo_count ?? 0,
  })
  return {
    accepted: row?.accepted_count ?? 0,
    waiting: row?.pending_count ?? 0,
    needs: row?.needs_another_photo_count ?? 0,
    photo: (asset: string) => list.find((p) => p.asset_id === asset) ?? null,
  }
}

const counts = async (who: TestIdentity, venue: string) => {
  const m = await month(who, venue)
  return { accepted: m.accepted, waiting: m.waiting, needs: m.needs }
}

beforeAll(async () => {
  admin = await createIdentity(service, { label: "area-admin", role: "admin" })
})

describe("who can label a photo with a venue area", () => {
  let f: Fixture
  let other: Fixture

  beforeAll(async () => {
    ;[f, other] = await Promise.all([
      venueWithPlaces("area-label"),
      venueWithPlaces("area-label-other"),
    ])
  })

  it("lets the uploader label, change and clear their own photo's area", async () => {
    const s = await newStaff("area-label-s", f.venue)
    const asset = (await reserveReady(service, s)).id
    const [first] = (await ok(setArea(s, asset, f.places.bar)))!
    expect(first).toMatchObject({ subject_id: f.places.bar, changed: true })

    const [same] = (await ok(setArea(s, asset, f.places.bar)))!
    expect(same).toEqual({ ...first, changed: false })

    const [moved] = (await ok(setArea(s, asset, f.places.garden)))!
    expect(moved!.label_id).not.toBe(first!.label_id)
    const [read] = (await ok(mine(s, [asset])))!
    expect(read).toMatchObject({ subject_label: "Garden", state: "pending" })

    await ok(setArea(s, asset, null))
    expect(await ok(mine(s, [asset]))).toEqual([])

    // Closed, never deleted.
    const data = rows(
      `select subject_id, removed_by from public.media_area_labels
       where asset_id = '${asset}' order by added_at`
    )
    expect(data).toEqual([
      { subject_id: f.places.bar, removed_by: s.id },
      { subject_id: f.places.garden, removed_by: s.id },
    ])
  })

  it("refuses someone else's photo, admins, manager accounts and direct writes", async () => {
    const [s, colleague, convert] = await Promise.all([
      newStaff("area-label-owner", f.venue),
      newStaff("area-label-colleague", f.venue),
      newStaff("area-label-convert", f.venue),
    ])
    const asset = (await reserveReady(service, s)).id
    await fails(
      setArea(colleague, asset, f.places.bar),
      "media_asset_not_found",
      "P0002"
    )
    await fails(setArea(admin, asset, f.places.bar), "not_active_user", "42501")
    await makeManager(admin, convert, f.venue)
    await fails(
      setArea(convert, asset, f.places.bar),
      "not_active_user",
      "42501"
    )

    const { error } = await colleague.client.from("media_area_labels").insert({
      asset_id: asset,
      venue_id: f.venue,
      subject_id: f.places.bar,
      subject_kind: "area",
      subject_label: "Bar",
      added_by: colleague.id,
    })
    expect(error?.code).toBe("42501")
    expect(await ok(mine(s, [asset]))).toEqual([])
  })

  it("refuses another venue's place, a retired place and a video", async () => {
    const s = await newStaff("area-label-places", f.venue)
    const asset = (await reserveReady(service, s)).id
    await fails(
      setArea(s, asset, other.places.bar),
      "area_wrong_venue",
      "22023"
    )
    await fails(
      setArea(s, asset, f.places.retired),
      "area_unavailable",
      "P0001"
    )
    const video = (await reserveReady(service, s, "video")).id
    await fails(
      setArea(s, video, f.places.bar),
      "area_label_image_only",
      "22023"
    )
  })
})

describe("who can review an area photo", () => {
  let f: Fixture
  let other: Fixture

  beforeAll(async () => {
    ;[f, other] = await Promise.all([
      venueWithPlaces("area-review"),
      venueWithPlaces("area-review-other"),
    ])
  })

  it("lists the venue's waiting area photos for its manager, and accepts", async () => {
    const s = await newStaff("area-review-s", f.venue)
    const { asset, label } = await areaPhoto(s, f.places.toilets)
    const rows = (await ok(queue(f.manager, f.venue)))!
    expect(rows.find((r) => r.label_id === label)).toMatchObject({
      asset_id: asset,
      author_id: s.id,
      subject_label: "Toilets",
      state: "pending",
      can_decide: true,
      credit_month: currentMonth(),
    })
    const [row] = (await ok(decide(f.manager, label, "accepted")))!
    expect(row).toEqual({ label_id: label, state: "accepted", changed: true })
    const [again] = (await ok(decide(f.manager, label, "accepted")))!
    expect(again!.changed).toBe(false)
    expect(
      (await ok(queue(f.manager, f.venue))).some((r) => r.label_id === label)
    ).toBe(false)
  })

  it("lets a manager account and an admin decide, with a reason to ask for another photo", async () => {
    const [s, convert] = await Promise.all([
      newStaff("area-review-s2", f.venue),
      newStaff("area-review-mgr", f.venue),
    ])
    await makeManager(admin, convert, f.venue)
    const one = await areaPhoto(s, f.places.bar)
    const two = await areaPhoto(s, f.places.garden)

    await fails(
      decide(convert, one.label, "needs_another_photo"),
      "reason_required",
      "P0001"
    )
    await fails(
      decide(convert, one.label, "needs_another_photo", "  "),
      "reason_required",
      "P0001"
    )
    const [asked] = (await ok(
      decide(convert, one.label, "needs_another_photo", "Too dark")
    ))!
    expect(asked!.state).toBe("needs_another_photo")
    // A reviewer may change their mind and accept; not the other way round.
    await ok(decide(admin, one.label, "accepted"))
    await fails(
      decide(convert, one.label, "needs_another_photo", "Blurry"),
      "area_photo_conflict",
      "40001"
    )
    await fails(
      decide(admin, two.label, "withdrawn", "Wrong"),
      "area_photo_conflict",
      "40001"
    )
    await ok(decide(admin, two.label, "accepted"))

    const data = rows(
      `select action, reason, decided_by from public.area_photo_decisions
       where label_id = '${one.label}' order by id`
    )
    expect(data).toEqual([
      {
        action: "needs_another_photo",
        reason: "Too dark",
        decided_by: convert.id,
      },
      { action: "accepted", reason: null, decided_by: admin.id },
    ])
  })

  it("never lets anyone decide on a photo they uploaded", async () => {
    // A legacy-grant manager is staff: they may label their own photo, and
    // another reviewer decides on it.
    const { label } = await areaPhoto(f.manager, f.places.bar)
    const row = (await ok(queue(f.manager, f.venue))).find(
      (r) => r.label_id === label
    )
    expect(row?.can_decide).toBe(false)
    await fails(
      decide(f.manager, label, "accepted"),
      "self_review_not_allowed",
      "42501"
    )
    await fails(
      decide(f.manager, label, "needs_another_photo", "Mine"),
      "self_review_not_allowed",
      "42501"
    )
    expect(
      rows(
        `select id from public.area_photo_decisions where label_id = '${label}'`
      )
    ).toEqual([])
  })

  it("lets a manager account open its own venue's area photo images, never another venue's (review c, 1)", async () => {
    const [s, convert, otherConvert, colleague] = await Promise.all([
      newStaff("area-image-s", f.venue),
      newStaff("area-image-mgr", f.venue),
      newStaff("area-image-mgr-other", other.venue),
      newStaff("area-image-colleague", f.venue),
    ])
    await Promise.all([
      makeManager(admin, convert, f.venue),
      makeManager(admin, otherConvert, other.venue),
    ])
    const { asset } = await areaPhoto(s, f.places.bar)
    const plain = (await reserveReady(service, s)).id
    // The check /api/area-photos/{id}/thumb|preview signs with.
    const canOpen = async (who: TestIdentity, id: string) =>
      ((await ok(who.client.rpc("area_photo_asset", { p_asset_id: id }))) ?? [])
        .length === 1

    expect(await canOpen(convert, asset)).toBe(true)
    expect(await canOpen(f.manager, asset)).toBe(true)
    expect(await canOpen(admin, asset)).toBe(true)
    expect(await canOpen(s, asset)).toBe(true)
    // Another venue's manager account and a colleague: nothing.
    expect(await canOpen(otherConvert, asset)).toBe(false)
    expect(await canOpen(colleague, asset)).toBe(false)
    // A photo with no area is not opened through this route.
    expect(await canOpen(convert, plain)).toBe(false)
    // The general media route is not widened: menu review's check still
    // refuses an area-only photo to the manager account.
    expect(
      (
        (await ok(
          convert.client.rpc("menu_item_photo_asset", { p_asset_id: asset })
        )) ?? []
      ).length
    ).toBe(0)
  })

  it("refuses staff without a grant and another venue's manager", async () => {
    const [s, colleague] = await Promise.all([
      newStaff("area-review-s3", f.venue),
      newStaff("area-review-colleague", f.venue),
    ])
    const { label } = await areaPhoto(s, f.places.bar)
    await fails(
      decide(colleague, label, "accepted"),
      "area_photo_not_found",
      "P0002"
    )
    await fails(queue(colleague, f.venue), "not_venue_manager", "42501")

    // Cross-venue: the same answer as an unknown id, and no queue.
    await fails(
      decide(other.manager, label, "accepted"),
      "area_photo_not_found",
      "P0002"
    )
    await fails(queue(other.manager, f.venue), "not_venue_manager", "42501")
    expect(
      (await ok(queue(other.manager, other.venue))).some(
        (r) => r.label_id === label
      )
    ).toBe(false)
    await fails(
      decide(admin, crypto.randomUUID(), "accepted"),
      "area_photo_not_found",
      "P0002"
    )
  })
})

describe("an area label counts as a label (S-1)", () => {
  let f: Fixture

  beforeAll(async () => {
    f = await venueWithPlaces("area-needs-labels")
  })

  it("takes the photo out of the uploader's needs-labels count", async () => {
    const s = await newStaff("area-needs-labels-s", f.venue)
    const asset = (await reserveReady(service, s)).id
    const needs = async () => (await ok(s.client.rpc("my_label_work")))![0]!
    const before = (await needs()).needs_labels
    expect(before).toBeGreaterThanOrEqual(1)
    await ok(setArea(s, asset, f.places.garden))
    expect((await needs()).needs_labels).toBe(before - 1)
    await ok(setArea(s, asset, null))
    expect((await needs()).needs_labels).toBe(before)
  })
})

describe("month credit for area photos", () => {
  let f: Fixture

  beforeAll(async () => {
    f = await venueWithPlaces("area-credit")
  })

  it("moves an area photo from waiting to needs another photo to accepted", async () => {
    const s = await newStaff("area-credit-states", f.venue)
    const { asset, label } = await areaPhoto(s, f.places.garden)
    expect(await counts(s, f.venue)).toEqual({
      accepted: 0,
      waiting: 1,
      needs: 0,
    })

    await ok(decide(f.manager, label, "needs_another_photo", "Too dark"))
    expect(await counts(s, f.venue)).toEqual({
      accepted: 0,
      waiting: 0,
      needs: 1,
    })

    await ok(decide(f.manager, label, "accepted"))
    const m = await month(s, f.venue)
    expect({
      accepted: m.accepted,
      waiting: m.waiting,
      needs: m.needs,
    }).toEqual({
      accepted: 1,
      waiting: 0,
      needs: 0,
    })
    expect(m.photo(asset)).toMatchObject({
      state: "accepted",
      item_names: ["Garden"],
    })
  })

  it("credits a photo once when it is also accepted for a dish and as a send", async () => {
    const s = await newStaff("area-credit-once", f.venue)
    const tikka = { itemId: f.items["mains--tikka"]!.itemId, variantId: null }
    const asset = (await reserveReady(service, s)).id
    await saveOk(s, {
      asset,
      revision: 0,
      items: [tikka],
      catalogue: f.version,
    })
    const [area] = (await ok(setArea(s, asset, f.places.bar)))!
    // A label, an area and a send: one waiting photo.
    const [sent] = await submit(s, [asset])
    expect(await counts(s, f.venue)).toEqual({
      accepted: 0,
      waiting: 1,
      needs: 0,
    })

    await ok(decide(f.manager, area!.label_id!, "accepted"))
    expect(await counts(s, f.venue)).toEqual({
      accepted: 1,
      waiting: 0,
      needs: 0,
    })

    const { data: head } = await service
      .from("menu_item_photo_heads")
      .select("revision")
      .eq("item_id", tikka.itemId)
      .maybeSingle()
    await ok(
      f.manager.client.rpc("review_menu_item_photo", {
        p_asset_id: asset,
        p_item_id: tikka.itemId,
        p_variant_id: null as unknown as string,
        p_decision: "accepted",
        p_expected_revision: head?.revision ?? 1,
        p_make_primary: false,
      })
    )
    const { data: item } = await service
      .from("coverage_submission_items")
      .select("id, revision, state")
      .eq("asset_id", asset)
      .single()
    if (item!.state === "submitted")
      await ok(reviewSend(f.manager, item!.id, item!.revision, "accepted"))
    expect(sent).toBeDefined()

    const m = await month(s, f.venue)
    expect({
      accepted: m.accepted,
      waiting: m.waiting,
      needs: m.needs,
    }).toEqual({
      accepted: 1,
      waiting: 0,
      needs: 0,
    })
    expect(m.photo(asset)!.item_names).toEqual(["Tikka", "Bar"])
  })

  it("removes the credit when a reviewer withdraws the photo", async () => {
    const s = await newStaff("area-credit-withdraw", f.venue)
    const { label } = await areaPhoto(s, f.places.toilets)
    await ok(decide(f.manager, label, "accepted"))
    expect((await counts(s, f.venue)).accepted).toBe(1)

    await fails(
      decide(f.manager, label, "withdrawn"),
      "reason_required",
      "P0001"
    )
    await ok(decide(f.manager, label, "withdrawn", "Shows a guest"))
    expect(await counts(s, f.venue)).toEqual({
      accepted: 0,
      waiting: 0,
      needs: 0,
    })
    // Withdrawn is final.
    await fails(
      decide(f.manager, label, "accepted"),
      "area_photo_conflict",
      "40001"
    )
  })

  it("refuses a new area on a photo whose area was withdrawn (review a, 1)", async () => {
    const s = await newStaff("area-credit-rewithdraw", f.venue)
    const { asset, label } = await areaPhoto(s, f.places.toilets)
    await ok(decide(f.manager, label, "accepted"))
    await ok(decide(f.manager, label, "withdrawn", "Shows a guest"))

    // Another place, or clearing and choosing again: refused, no new row.
    await fails(
      setArea(s, asset, f.places.garden),
      "area_photo_withdrawn",
      "P0001"
    )
    await ok(setArea(s, asset, null))
    await fails(
      setArea(s, asset, f.places.toilets),
      "area_photo_withdrawn",
      "P0001"
    )
    expect(
      rows(
        `select id from public.media_area_labels where asset_id = '${asset}' and removed_at is null`
      )
    ).toEqual([])
    expect(
      (await ok(queue(f.manager, f.venue))).some((r) => r.asset_id === asset)
    ).toBe(false)
    expect(await counts(s, f.venue)).toEqual({
      accepted: 0,
      waiting: 0,
      needs: 0,
    })
  })

  it("removes the credit when the uploader removes or changes the area", async () => {
    const s = await newStaff("area-credit-remove", f.venue)
    const a = await areaPhoto(s, f.places.bar)
    const b = await areaPhoto(s, f.places.garden)
    await ok(decide(f.manager, a.label, "accepted"))
    await ok(decide(f.manager, b.label, "accepted"))
    expect((await counts(s, f.venue)).accepted).toBe(2)

    await ok(setArea(s, a.asset, null))
    expect(await counts(s, f.venue)).toEqual({
      accepted: 1,
      waiting: 0,
      needs: 0,
    })
    // A new area is a new label: it waits for review again.
    await ok(setArea(s, b.asset, f.places.toilets))
    expect(await counts(s, f.venue)).toEqual({
      accepted: 0,
      waiting: 1,
      needs: 0,
    })
    // The old decision cannot be used on a closed label.
    await fails(
      decide(f.manager, a.label, "withdrawn", "x"),
      "area_photo_not_found",
      "P0002"
    )
  })

  it("removes the credit when the photo is deleted, and counts only the upload month", async () => {
    const s = await newStaff("area-credit-delete", f.venue)
    const { asset, label } = await areaPhoto(s, f.places.bar)
    await ok(decide(f.manager, label, "accepted"))
    expect((await counts(s, f.venue)).accepted).toBe(1)
    const { error } = await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", asset)
    expect(error).toBeNull()
    expect((await counts(s, f.venue)).accepted).toBe(0)

    // Uploaded last month, labelled and accepted now: last month's credit.
    const last = monthOffset(-1)
    const old = await insertAsset(service, {
      uploader: s.id,
      venue: f.venue,
      createdAt: midMonth(last),
    })
    const [row] = (await ok(setArea(s, old.id, f.places.garden)))!
    await ok(decide(f.manager, row!.label_id!, "accepted"))
    expect((await counts(s, f.venue)).accepted).toBe(0)
    expect((await month(s, f.venue, last)).accepted).toBe(1)
  })

  it("does not count a photo someone else labelled", async () => {
    const s = await newStaff("area-credit-other", f.venue)
    const asset = await insertAsset(service, { uploader: s.id, venue: f.venue })
    psql(
      `insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
       values ('${asset.id}', '${f.venue}', '${f.places.bar}', 'area', 'Bar', '${f.manager.id}')`
    )
    expect(await counts(s, f.venue)).toEqual({
      accepted: 0,
      waiting: 0,
      needs: 0,
    })
    expect(
      (await ok(queue(f.manager, f.venue))).some((r) => r.asset_id === asset.id)
    ).toBe(false)
  })
})
