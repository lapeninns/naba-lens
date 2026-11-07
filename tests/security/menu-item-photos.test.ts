// Our menu item-photo contract (contract decision 7): explicit per-item
// acceptance of labelled photos, scoped to the asset's original upload venue,
// with replay, compare-and-set on the item head, self-review, primary photos,
// label removal, read-time eligibility, menu activation reconciliation and the
// no_menu / empty / ready states. Real signed-in identities through PostgREST;
// the service role only builds fixtures, reads state back and probes guards.
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
  legacyStaffGrant,
  ok,
  requestKey,
  staffProgress,
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
let admin: TestIdentity

type Decision = "accepted" | "better_photo_requested"

type Fixture = {
  venue: string
  version: string
  manager: TestIdentity
  staff: TestIdentity
  staff2: TestIdentity
  items: Record<string, CatalogueRow>
}

const MENU = () =>
  menu("TEST Our menu", [
    section("mains", "Mains", [
      item("mains--korma", "Korma", { variants: ["Chicken", "Lamb"] }),
      item("mains--tikka", "Tikka"),
      item("mains--dal", "Dal", { description: "Yellow lentils" }),
      item("mains--bhaji", "Bhaji"),
    ]),
    section("drinks", "Drinks", [item("drinks--lassi", "Lassi")], "drinks"),
    section("extras", "Extras", [item("extras--card", "Gift card")], "other"),
  ])

async function venueWithMenu(label: string): Promise<Fixture> {
  const venue = (await createVenue(service, label)).id
  const [manager, staff, staff2] = await Promise.all([
    createIdentity(service, {
      label: `${label}-mgr`,
      role: "staff",
      venueId: venue,
    }),
    createIdentity(service, {
      label: `${label}-s1`,
      role: "staff",
      venueId: venue,
    }),
    createIdentity(service, {
      label: `${label}-s2`,
      role: "staff",
      venueId: venue,
    }),
  ])
  // Staff-held grant: the transitional rule keeps these effective.
  await legacyStaffGrant(service, admin, manager.id, venue)
  const version = await publishMenu(admin, venue, MENU())
  const items = (await readDocument(service, version)).byKey
  return { venue, version, manager, staff, staff2, items }
}

type Tuple = { itemId: string; variantId: string | null }
const t = (row: CatalogueRow, variant?: number): Tuple => ({
  itemId: row.itemId,
  variantId: variant === undefined ? null : row.variants[variant]!.variantId,
})

/** A ready photo by `who`, labelled with the tuples on the venue's active menu. */
async function labelled(
  who: TestIdentity,
  version: string,
  tuples: Tuple[],
  mediaType: "image" | "video" = "image"
) {
  const asset = await reserveReady(service, who, mediaType)
  const saved = await saveOk(who, {
    asset: asset.id,
    revision: 0,
    items: tuples,
    catalogue: version,
  })
  return { id: asset.id, revision: saved!.revision }
}

async function head(itemId: string) {
  const { data, error } = await service
    .from("menu_item_photo_heads")
    .select("revision")
    .eq("item_id", itemId)
    .maybeSingle()
  if (error) throw error
  return data?.revision ?? 1
}

function review(
  who: TestIdentity,
  asset: string,
  tuple: Tuple,
  decision: Decision,
  revision: number,
  opts: { reason?: string; primary?: boolean; key?: string } = {}
) {
  return who.client.rpc("review_menu_item_photo", {
    p_asset_id: asset,
    p_item_id: tuple.itemId,
    p_variant_id: tuple.variantId as string,
    p_decision: decision,
    p_expected_revision: revision,
    ...(opts.reason ? { p_reason: opts.reason } : {}),
    p_make_primary: opts.primary ?? false,
    ...(opts.key ? { p_client_request_key: opts.key } : {}),
  })
}

async function accept(
  who: TestIdentity,
  asset: string,
  tuple: Tuple,
  primary = false
) {
  const [row] = await ok(
    review(who, asset, tuple, "accepted", await head(tuple.itemId), { primary })
  )
  return row!
}

function withdraw(
  who: TestIdentity,
  photo: string,
  revision: number,
  reason: string | null,
  key?: string
) {
  return who.client.rpc("withdraw_menu_item_photo", {
    p_photo_id: photo,
    p_expected_revision: revision,
    p_reason: reason as string,
    ...(key ? { p_client_request_key: key } : {}),
  })
}

function setPrimary(
  who: TestIdentity,
  photo: string,
  revision: number,
  key?: string
) {
  return who.client.rpc("set_menu_item_primary_photo", {
    p_photo_id: photo,
    p_expected_revision: revision,
    ...(key ? { p_client_request_key: key } : {}),
  })
}

async function summary(who: TestIdentity, venue: string | null) {
  return ok(
    who.client.rpc(
      "menu_item_photo_summary",
      venue ? { p_venue_id: venue } : {}
    )
  )
}

async function totals(who: TestIdentity, venue: string) {
  const rows = await summary(who, venue)
  return {
    state: rows[0]!.menu_state,
    eligible: rows.reduce((n, r) => n + r.eligible_items, 0),
    covered: rows.reduce((n, r) => n + r.covered_items, 0),
    recheck: rows.reduce((n, r) => n + r.needs_recheck_items, 0),
  }
}

async function itemRow(who: TestIdentity, venue: string, itemId: string) {
  const rows = await ok(
    who.client.rpc("menu_item_photo_items", { p_venue_id: venue, p_limit: 101 })
  )
  return rows.find((r) => r.item_id === itemId) ?? null
}

async function photo(id: string) {
  const { data, error } = await service
    .from("menu_item_photos")
    .select("*")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

async function events(photoId: string) {
  const { data, error } = await service
    .from("menu_item_photo_events")
    .select(
      "action, from_state, to_state, self_review, actor_role, client_request_key, item_revision"
    )
    .eq("photo_id", photoId)
    .order("id")
  if (error) throw error
  return data
}

async function previewable(who: TestIdentity, asset: string) {
  const rows = await ok(
    who.client.rpc("menu_item_photo_asset", { p_asset_id: asset })
  )
  return rows.length === 1
}

beforeAll(async () => {
  admin = await createIdentity(service, { label: "mip-admin", role: "admin" })
})

describe("accepting, asking for a better photo and replays", () => {
  let f: Fixture
  let korma: Tuple
  let photoA: string

  beforeAll(async () => {
    f = await venueWithMenu("mip-accept")
    korma = t(f.items["mains--korma"]!, 0)
    photoA = (await labelled(f.staff, f.version, [korma])).id
  })

  it("lists the labelled photo, accepts it, counts the item once and makes it primary", async () => {
    expect(await totals(f.staff, f.venue)).toEqual({
      state: "ready",
      eligible: 5, // korma, tikka, dal, bhaji, lassi; the `other` gift card is left out
      covered: 0,
      recheck: 0,
    })
    const candidates = await ok(
      f.manager.client.rpc("menu_item_photo_candidates", {
        p_venue_id: f.venue,
      })
    )
    expect(candidates).toEqual([
      expect.objectContaining({
        asset_id: photoA,
        item_id: korma.itemId,
        variant_id: korma.variantId,
        variant_name: "Chicken",
        photo_id: null,
        is_self: false,
        item_revision: 1,
      }),
    ])
    const [row] = await ok(review(f.manager, photoA, korma, "accepted", 1))
    expect(row).toMatchObject({
      state: "accepted",
      is_primary: true,
      item_revision: 2,
      self_review: false,
      replayed: false,
    })
    expect(await totals(f.staff, f.venue)).toMatchObject({
      covered: 1,
      eligible: 5,
    })
    const kormaRow = await itemRow(f.staff, f.venue, korma.itemId)
    expect(kormaRow).toMatchObject({
      covered: true,
      accepted_count: 1,
      primary_asset_id: photoA,
      item_revision: 2,
      candidate_count: null, // staff see no reviewer figures
    })
    // The photo is decided: it leaves the default candidate list.
    expect(
      await ok(
        f.manager.client.rpc("menu_item_photo_candidates", {
          p_venue_id: f.venue,
        })
      )
    ).toEqual([])
    const stored = await photo(row!.photo_id)
    expect(stored).toMatchObject({
      author_id: f.staff.id,
      decided_by: f.manager.id,
      venue_id: f.venue,
      item_name: "Korma",
      variant_name: "Chicken",
      section_kind: "food",
      menu_version_id: f.version,
    })
  })

  it("asks for a better photo only with a reason, and the item stays a gap", async () => {
    const tikka = t(f.items["mains--tikka"]!)
    const asset = (await labelled(f.staff2, f.version, [tikka])).id
    await fails(
      review(f.manager, asset, tikka, "better_photo_requested", 1),
      "reason_required",
      "22023"
    )
    const [row] = await ok(
      review(f.manager, asset, tikka, "better_photo_requested", 1, {
        reason: "Too dark",
      })
    )
    expect(row).toMatchObject({
      state: "better_photo_requested",
      is_primary: false,
    })
    expect(await itemRow(f.manager, f.venue, tikka.itemId)).toMatchObject({
      covered: false,
    })
    // A better-photo row can still be accepted later; it then becomes primary.
    const [accepted] = await ok(review(f.manager, asset, tikka, "accepted", 2))
    expect(accepted).toMatchObject({
      photo_id: row!.photo_id,
      state: "accepted",
      is_primary: true,
    })
    // An accepted photo cannot be turned into a better-photo request: withdraw first.
    await fails(
      review(f.manager, asset, tikka, "better_photo_requested", 3, {
        reason: "Changed my mind",
      }),
      "invalid_transition",
      "P0001"
    )
  })

  it("replays the same decision and refuses a reused key", async () => {
    const lassi = t(f.items["drinks--lassi"]!)
    const asset = (await labelled(f.staff, f.version, [lassi])).id
    const key = requestKey()
    const [first] = await ok(
      review(f.manager, asset, lassi, "accepted", 1, { key })
    )
    const [again] = await ok(
      review(f.manager, asset, lassi, "accepted", 1, { key })
    )
    expect(again).toMatchObject({
      photo_id: first!.photo_id,
      replayed: true,
      item_revision: 2,
    })
    await fails(
      review(f.manager, asset, lassi, "better_photo_requested", 2, {
        key,
        reason: "x",
      }),
      "idempotency_key_reused",
      "22023"
    )
    // Without a key, the same decision at the current revision is a no-op replay.
    const [noop] = await ok(review(f.manager, asset, lassi, "accepted", 2))
    expect(noop).toMatchObject({
      photo_id: first!.photo_id,
      replayed: true,
      item_revision: 2,
    })
    expect(
      (await events(first!.photo_id)).filter((e) => e.action === "accepted")
    ).toHaveLength(1)
    expect(await head(lassi.itemId)).toBe(2)
  })

  it("reports a stale decision when two reviewers act on the same item at once", async () => {
    const dal = t(f.items["mains--dal"]!)
    const [p1, p2] = await Promise.all([
      labelled(f.staff, f.version, [dal]),
      labelled(f.staff2, f.version, [dal]),
    ])
    const results = await Promise.all([
      review(f.manager, p1.id, dal, "accepted", 1),
      review(admin, p2.id, dal, "accepted", 1),
    ])
    const errors = results.filter((r) => r.error)
    expect(results.filter((r) => !r.error)).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.error).toMatchObject({
      message: "coverage_conflict",
      code: "40001",
    })
    expect(JSON.parse(errors[0]!.error!.details!)).toEqual({ revision: 2 })
    // A stale revision on its own is also a conflict.
    const loser = results[0]!.error ? p1.id : p2.id
    await fails(
      review(f.manager, loser, dal, "accepted", 1),
      "coverage_conflict",
      "40001"
    )
    const [late] = await ok(review(f.manager, loser, dal, "accepted", 2))
    expect(late).toMatchObject({ is_primary: false, item_revision: 3 })
    expect(await itemRow(f.manager, f.venue, dal.itemId)).toMatchObject({
      accepted_count: 2,
    })
  })

  it("flags self-review and records it for admin oversight", async () => {
    const bhaji = t(f.items["mains--bhaji"]!)
    const own = (await labelled(f.manager, f.version, [bhaji])).id
    const [row] = await ok(review(f.manager, own, bhaji, "accepted", 1))
    expect(row).toMatchObject({ self_review: true })
    expect(await photo(row!.photo_id)).toMatchObject({
      self_review: true,
      author_id: f.manager.id,
    })
    expect(await events(row!.photo_id)).toEqual([
      expect.objectContaining({
        action: "accepted",
        self_review: true,
        actor_role: "manager",
      }),
    ])
    const { data, error } = await admin.client
      .from("menu_item_photo_events")
      .select("photo_id")
      .eq("self_review", true)
      .eq("venue_id", f.venue)
    expect(error).toBeNull()
    expect(data).toEqual([{ photo_id: row!.photo_id }])
  })

  it("lets the uploader read their own rows and nobody else's", async () => {
    const own = await f.staff.client
      .from("menu_item_photos")
      .select("asset_id, state")
    expect(own.error).toBeNull()
    expect(own.data!.length).toBeGreaterThan(0)
    expect(own.data!.every((r) => r.asset_id !== undefined)).toBe(true)
    const authors = await f.staff.client
      .from("menu_item_photos")
      .select("author_id")
    expect(new Set(authors.data!.map((r) => r.author_id))).toEqual(
      new Set([f.staff.id])
    )
    // The manager sees every row of the venue.
    const venueRows = await f.manager.client
      .from("menu_item_photos")
      .select("id")
      .eq("venue_id", f.venue)
    expect(venueRows.data!.length).toBeGreaterThanOrEqual(5)
  })
})

describe("scope", () => {
  let f: Fixture
  let other: Fixture
  let korma: Tuple
  let asset: string
  let photoId: string

  beforeAll(async () => {
    ;[f, other] = await Promise.all([
      venueWithMenu("mip-scope-a"),
      venueWithMenu("mip-scope-b"),
    ])
    korma = t(f.items["mains--korma"]!)
    asset = (await labelled(f.staff, f.version, [korma])).id
    photoId = (await accept(f.manager, asset, korma)).photo_id
  })

  it("denies another venue's manager every read and write, and leaks nothing", async () => {
    await fails(
      review(other.manager, asset, korma, "accepted", 2),
      "media_asset_not_found",
      "P0002"
    )
    await fails(
      withdraw(other.manager, photoId, 2, "No"),
      "menu_item_photo_not_found",
      "P0002"
    )
    await fails(
      setPrimary(other.manager, photoId, 2),
      "menu_item_photo_not_found",
      "P0002"
    )
    await fails(
      other.manager.client.rpc("menu_item_photo_candidates", {
        p_venue_id: f.venue,
      }),
      "not_venue_manager",
      "42501"
    )
    await fails(
      other.manager.client.rpc("menu_item_photo_summary", {
        p_venue_id: f.venue,
      }),
      "venue_not_found",
      "P0002"
    )
    await fails(
      other.manager.client.rpc("menu_item_photo_items", {
        p_venue_id: f.venue,
      }),
      "venue_not_found",
      "P0002"
    )
    expect(await previewable(other.manager, asset)).toBe(false)
    const rows = await other.manager.client
      .from("menu_item_photos")
      .select("id")
      .eq("id", photoId)
    expect(rows.data).toEqual([])
    // An item of another venue is never reviewable against this venue's photo.
    const foreign = t(other.items["mains--tikka"]!)
    await fails(
      review(f.manager, asset, foreign, "accepted", 1),
      "menu_item_unavailable",
      "P0001"
    )
  })

  it("lets staff read only their own venue and write nothing", async () => {
    await fails(
      review(f.staff, asset, korma, "accepted", 2),
      "media_asset_not_found",
      "P0002"
    )
    await fails(
      review(f.staff2, asset, korma, "accepted", 2),
      "media_asset_not_found",
      "P0002"
    )
    await fails(
      withdraw(f.staff, photoId, 2, "No"),
      "menu_item_photo_not_found",
      "P0002"
    )
    await fails(
      setPrimary(f.staff, photoId, 2),
      "menu_item_photo_not_found",
      "P0002"
    )
    await fails(
      f.staff.client.rpc("menu_item_photo_candidates", {}),
      "not_venue_manager",
      "42501"
    )
    const insert = await f.staff.client.from("menu_item_photos").insert({
      venue_id: f.venue,
      item_id: korma.itemId,
      asset_id: asset,
      author_id: f.staff.id,
      state: "accepted",
      item_name: "Korma",
      section_name: "Mains",
      section_kind: "food",
      menu_version_id: f.version,
      decided_by: f.staff.id,
      self_review: true,
    })
    expect(insert.error?.code).toBe("42501")
    const update = await f.staff.client
      .from("menu_item_photos")
      .update({ is_primary: false })
      .eq("id", photoId)
    expect(update.error?.code).toBe("42501")
    // Staff summary defaults to, and is limited to, their own venue.
    const own = await summary(f.staff, null)
    expect(own[0]).toMatchObject({ venue_id: f.venue, menu_state: "ready" })
    await fails(
      f.staff.client.rpc("menu_item_photo_summary", {
        p_venue_id: other.venue,
      }),
      "venue_not_found",
      "P0002"
    )
    // Staff at the venue may preview the item's primary photo only.
    expect(await previewable(f.staff2, asset)).toBe(true)
    expect(await previewable(other.staff, asset)).toBe(false)
    const unreviewed = (
      await labelled(f.staff, f.version, [t(f.items["mains--tikka"]!)])
    ).id
    expect(await previewable(f.staff2, unreviewed)).toBe(false)
    expect(await previewable(f.manager, unreviewed)).toBe(true)
  })

  it("denies a signed-in account that is no longer active staff, for any venue", async () => {
    // Regression: with no active staff venue the scope check compared with
    // NULL and fell through, so a deactivated account could read any venue.
    const g = await venueWithMenu("mip-scope-inactive")
    const { error } = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", g.staff2.id)
    if (error) throw error
    for (const venue of [f.venue, g.venue, undefined]) {
      for (const fn of [
        "menu_item_photo_summary",
        "menu_item_photo_items",
      ] as const) {
        await fails(
          g.staff2.client.rpc(fn, { p_venue_id: venue }),
          "venue_not_found",
          "P0002"
        )
      }
    }
  })

  it("requires an admin to name the venue", async () => {
    await fails(
      admin.client.rpc("menu_item_photo_summary", {}),
      "venue_not_found",
      "P0002"
    )
    expect((await summary(admin, f.venue))[0]).toMatchObject({
      venue_id: f.venue,
    })
    const items = await ok(
      admin.client.rpc("menu_item_photo_items", { p_venue_id: f.venue })
    )
    expect(items.find((r) => r.item_id === korma.itemId)).toMatchObject({
      covered: true,
      candidate_count: 0,
    })
  })

  it("refuses an unlabelled tuple and an item outside the eligible menu", async () => {
    const tikka = t(f.items["mains--tikka"]!)
    await fails(
      review(f.manager, asset, tikka, "accepted", 1),
      "menu_item_not_labelled",
      "P0001"
    )
    const card = t(f.items["extras--card"]!)
    const cardAsset = (await labelled(f.staff, f.version, [card])).id
    await fails(
      review(f.manager, cardAsset, card, "accepted", 1),
      "menu_item_unavailable",
      "P0001"
    )
  })
})

describe("eligibility: deleted, relabelled and non-image photos, label removal", () => {
  let f: Fixture

  beforeAll(async () => {
    f = await venueWithMenu("mip-eligible")
  })

  it("drops a deleted photo from the count and previews, and falls back to another accepted photo", async () => {
    const tikka = t(f.items["mains--tikka"]!)
    const first = await labelled(f.staff, f.version, [tikka])
    const second = await labelled(f.staff2, f.version, [tikka])
    const a = await accept(f.manager, first.id, tikka)
    const b = await accept(f.manager, second.id, tikka)
    expect(a.is_primary).toBe(true)
    expect(b.is_primary).toBe(false)
    await ok(f.staff.client.rpc("delete_media_asset", { p_asset_id: first.id }))
    expect(await itemRow(f.staff, f.venue, tikka.itemId)).toMatchObject({
      covered: true,
      accepted_count: 1,
      primary_photo_id: b.photo_id,
      primary_asset_id: second.id,
    })
    expect(await previewable(f.staff, first.id)).toBe(false)
    expect(await previewable(f.manager, first.id)).toBe(false)
    expect(await previewable(f.staff, second.id)).toBe(true)
    // The deleted primary cannot be made primary again, and cannot be reviewed.
    await fails(
      setPrimary(f.manager, a.photo_id, await head(tikka.itemId)),
      "evidence_not_eligible",
      "P0001"
    )
    await ok(
      f.staff2.client.rpc("delete_media_asset", { p_asset_id: second.id })
    )
    expect(await itemRow(f.staff, f.venue, tikka.itemId)).toMatchObject({
      covered: false,
      accepted_count: 0,
      primary_photo_id: null,
    })
    expect((await totals(f.staff, f.venue)).covered).toBe(0)
  })

  it("never lists or accepts a video", async () => {
    const dal = t(f.items["mains--dal"]!)
    const video = await labelled(f.staff, f.version, [dal], "video")
    const candidates = await ok(
      f.manager.client.rpc("menu_item_photo_candidates", {
        p_venue_id: f.venue,
        p_item_id: dal.itemId,
      })
    )
    expect(candidates.map((c) => c.asset_id)).not.toContain(video.id)
    const error = await fails(
      review(f.manager, video.id, dal, "accepted", 1),
      "evidence_not_eligible",
      "P0001"
    )
    expect(error.details).toBe("not_image")
  })

  it("invalidates the acceptance when its label is removed or changed", async () => {
    const korma = f.items["mains--korma"]!
    const chicken = t(korma, 0)
    const lamb = t(korma, 1)
    const asset = await labelled(f.staff, f.version, [chicken])
    const accepted = await accept(f.manager, asset.id, chicken)
    const before = await head(korma.itemId)
    // Relabel Chicken -> Lamb: the reviewed tuple is gone.
    const relabelled = await saveOk(f.staff, {
      asset: asset.id,
      revision: asset.revision,
      items: [lamb],
      catalogue: f.version,
    })
    expect(await photo(accepted.photo_id)).toMatchObject({
      state: "invalidated",
      invalidation_kind: "label_removed",
      is_primary: false,
    })
    expect(await head(korma.itemId)).toBe(before + 1)
    expect(await itemRow(f.staff, f.venue, korma.itemId)).toMatchObject({
      covered: false,
    })
    expect(
      (await events(accepted.photo_id)).map((e) => [e.action, e.actor_role])
    ).toEqual([
      ["accepted", "manager"],
      ["invalidated", "system"],
    ])
    // The new tuple is a fresh candidate; accept it, then remove every label.
    const again = await accept(f.manager, asset.id, lamb)
    expect(again.photo_id).not.toBe(accepted.photo_id)
    await saveOk(f.staff, {
      asset: asset.id,
      revision: relabelled!.revision,
      items: [],
      catalogue: f.version,
    })
    expect(await photo(again.photo_id)).toMatchObject({ state: "invalidated" })
    expect(await itemRow(f.staff, f.venue, korma.itemId)).toMatchObject({
      covered: false,
      primary_photo_id: null,
    })
    // A final row is never revived.
    await fails(
      withdraw(f.manager, again.photo_id, await head(korma.itemId), "Undo"),
      "invalid_transition",
      "P0001"
    )
    // The self-review audit keeps showing the decided photo to admins.
    expect(await previewable(admin, asset.id)).toBe(true)
  })

  it("invalidates several items in one label save, bumping each head once", async () => {
    const korma = f.items["mains--korma"]!
    const chicken = t(korma, 0)
    const lamb = t(korma, 1)
    const bhaji = t(f.items["mains--bhaji"]!)
    const lassi = t(f.items["drinks--lassi"]!)
    const asset = await labelled(f.staff2, f.version, [
      chicken,
      lamb,
      bhaji,
      lassi,
    ])
    const accepted = [
      await accept(f.manager, asset.id, chicken),
      await accept(f.manager, asset.id, lamb),
      await accept(f.manager, asset.id, bhaji),
      await accept(f.manager, asset.id, lassi),
    ]
    const before = {
      korma: await head(korma.itemId),
      bhaji: await head(bhaji.itemId),
      lassi: await head(lassi.itemId),
    }
    await saveOk(f.staff2, {
      asset: asset.id,
      revision: asset.revision,
      items: [],
      catalogue: f.version,
    })
    for (const row of accepted)
      expect(await photo(row.photo_id)).toMatchObject({
        state: "invalidated",
        invalidation_kind: "label_removed",
        is_primary: false,
      })
    // One statement, one increment per item (korma had two variant tuples).
    expect(await head(korma.itemId)).toBe(before.korma + 1)
    expect(await head(bhaji.itemId)).toBe(before.bhaji + 1)
    expect(await head(lassi.itemId)).toBe(before.lassi + 1)
  })
})

describe("primary photos and withdrawal", () => {
  let f: Fixture

  beforeAll(async () => {
    f = await venueWithMenu("mip-primary")
  })

  it("replaces the primary, hands it over on withdrawal and reopens the gap", async () => {
    const dal = t(f.items["mains--dal"]!)
    const [p1, p2, p3] = await Promise.all([
      labelled(f.staff, f.version, [dal]),
      labelled(f.staff2, f.version, [dal]),
      labelled(f.staff, f.version, [dal]),
    ])
    const a = await accept(f.manager, p1.id, dal)
    const b = await accept(f.manager, p2.id, dal)
    expect([a.is_primary, b.is_primary]).toEqual([true, false])

    const key = requestKey()
    const [set] = await ok(
      setPrimary(f.manager, b.photo_id, await head(dal.itemId), key)
    )
    expect(set).toMatchObject({ photo_id: b.photo_id, replayed: false })
    const [setAgain] = await ok(setPrimary(f.manager, b.photo_id, 1, key))
    expect(setAgain).toMatchObject({
      replayed: true,
      item_revision: set!.item_revision,
    })
    expect((await photo(a.photo_id)).is_primary).toBe(false)
    expect((await photo(b.photo_id)).is_primary).toBe(true)
    expect(await itemRow(f.staff, f.venue, dal.itemId)).toMatchObject({
      primary_photo_id: b.photo_id,
    })

    // A newer photo accepted as primary takes over; the others stay accepted.
    const c = await accept(f.manager, p3.id, dal, true)
    expect(c.is_primary).toBe(true)
    expect(await photo(b.photo_id)).toMatchObject({
      state: "accepted",
      is_primary: false,
    })

    await fails(
      withdraw(f.manager, c.photo_id, await head(dal.itemId), null),
      "reason_required",
      "22023"
    )
    await fails(
      withdraw(f.manager, c.photo_id, 1, "Blurry"),
      "coverage_conflict",
      "40001"
    )
    const wKey = requestKey()
    const [w] = await ok(
      withdraw(f.manager, c.photo_id, await head(dal.itemId), "Blurry", wKey)
    )
    expect(w).toMatchObject({
      state: "withdrawn",
      new_primary_photo_id: a.photo_id,
      replayed: false,
    })
    const [wAgain] = await ok(
      withdraw(f.manager, c.photo_id, 1, "Blurry", wKey)
    )
    expect(wAgain).toMatchObject({
      replayed: true,
      new_primary_photo_id: a.photo_id,
    })
    expect(await photo(c.photo_id)).toMatchObject({
      state: "withdrawn",
      reason: "Blurry",
      withdrawn_by: f.manager.id,
      is_primary: false,
    })
    expect((await photo(a.photo_id)).is_primary).toBe(true)

    await ok(withdraw(admin, a.photo_id, await head(dal.itemId), "Wrong dish"))
    const [last] = await ok(
      withdraw(f.manager, b.photo_id, await head(dal.itemId), "Old plating")
    )
    expect(last!.new_primary_photo_id).toBeNull()
    expect(await itemRow(f.staff, f.venue, dal.itemId)).toMatchObject({
      covered: false,
      accepted_count: 0,
      primary_photo_id: null,
    })
    // A withdrawn photo can be accepted again as a new decision.
    const back = await accept(f.manager, p1.id, dal)
    expect(back.photo_id).not.toBe(a.photo_id)
    expect(back.is_primary).toBe(true)
  })

  it("keeps a withdrawn photo out of the waiting queue and count until relabelled", async () => {
    const lassi = t(f.items["drinks--lassi"]!)
    const asset = await labelled(f.staff, f.version, [lassi])
    const queue = async (reviewed = false) =>
      (
        await ok(
          f.manager.client.rpc("menu_item_photo_candidates", {
            p_venue_id: f.venue,
            p_item_id: lassi.itemId,
            p_include_reviewed: reviewed,
          })
        )
      ).map((c) => c.asset_id)
    expect(await queue()).toEqual([asset.id])
    expect(await itemRow(f.manager, f.venue, lassi.itemId)).toMatchObject({
      candidate_count: 1,
    })
    const a = await accept(f.manager, asset.id, lassi)
    await ok(
      withdraw(f.manager, a.photo_id, await head(lassi.itemId), "Wrong glass")
    )
    expect(await queue()).toEqual([])
    expect(await queue(true)).toEqual([asset.id])
    expect(await itemRow(f.manager, f.venue, lassi.itemId)).toMatchObject({
      candidate_count: 0,
      oldest_candidate_at: null,
    })
    // Relabelling (remove, then add the tuple again) makes it waiting once more.
    const cleared = await saveOk(f.staff, {
      asset: asset.id,
      revision: asset.revision,
      items: [],
      catalogue: f.version,
    })
    await saveOk(f.staff, {
      asset: asset.id,
      revision: cleared!.revision,
      items: [lassi],
      catalogue: f.version,
    })
    expect(await queue()).toEqual([asset.id])
    expect(await itemRow(f.manager, f.venue, lassi.itemId)).toMatchObject({
      candidate_count: 1,
    })
  })

  it("keeps history: no deletes, identity is fixed, decisions only move forward", async () => {
    const { data } = await service
      .from("menu_item_photos")
      .select("id, asset_id")
      .eq("venue_id", f.venue)
      .limit(1)
    const row = data![0]!
    const del = await service.from("menu_item_photos").delete().eq("id", row.id)
    expect(del.error).not.toBeNull()
    const move = await service
      .from("menu_item_photos")
      .update({ asset_id: crypto.randomUUID(), revision: 99 })
      .eq("id", row.id)
    expect(move.error).not.toBeNull()
    const evDel = await service
      .from("menu_item_photo_events")
      .delete()
      .eq("photo_id", row.id)
    expect(evDel.error).not.toBeNull()
  })
})

describe("menu activation", () => {
  let f: Fixture
  let rows: Record<string, string>

  beforeAll(async () => {
    f = await venueWithMenu("mip-activate")
    const i = f.items
    const tuples: Record<string, Tuple> = {
      korma: t(i["mains--korma"]!, 0),
      tikka: t(i["mains--tikka"]!),
      dal: t(i["mains--dal"]!),
      bhaji: t(i["mains--bhaji"]!),
      lassi: t(i["drinks--lassi"]!),
    }
    rows = {}
    for (const [name, tuple] of Object.entries(tuples)) {
      const asset = await labelled(f.staff, f.version, [tuple])
      rows[name] = (await accept(f.manager, asset.id, tuple)).photo_id
    }
    expect(await totals(f.staff, f.venue)).toMatchObject({
      eligible: 5,
      covered: 5,
    })

    // V2: Chicken korma is no longer offered, tikka is renamed, lassi moves to a
    // food section, dal only changes case, spacing and description, bhaji is gone.
    const korma = i["mains--korma"]!
    await publishMenu(
      admin,
      f.venue,
      menu("TEST Our menu v2", [
        section("mains", "Mains", [
          item("mains--korma", "Korma", {
            itemId: korma.itemId,
            variants: [
              { variantId: korma.variants[1]!.variantId, name: "Lamb" },
            ],
          }),
          item("mains--tikka", "Paneer tikka", {
            itemId: i["mains--tikka"]!.itemId,
          }),
          item("mains--dal", "  DAL ", {
            itemId: i["mains--dal"]!.itemId,
            description: "Black lentils",
          }),
          item("drinks--lassi", "Lassi", {
            itemId: i["drinks--lassi"]!.itemId,
          }),
          item("mains--new", "Biryani"),
        ]),
      ]),
      f.version
    )
  })

  it("carries what is materially the same and sends the rest for recheck", async () => {
    expect(await photo(rows.dal!)).toMatchObject({ state: "accepted" })
    expect((await photo(rows.dal!)).item_name.trim()).toBe("DAL")
    expect((await photo(rows.dal!)).menu_version_id).not.toBe(f.version)
    expect(await photo(rows.korma!)).toMatchObject({
      state: "needs_recheck",
      recheck_kind: "variant_removed",
      is_primary: false,
    })
    expect(await photo(rows.tikka!)).toMatchObject({
      state: "needs_recheck",
      recheck_kind: "name_changed",
    })
    expect(await photo(rows.lassi!)).toMatchObject({
      state: "needs_recheck",
      recheck_kind: "section_changed",
    })
    // A removed dish keeps its row untouched and leaves the denominator.
    expect(await photo(rows.bhaji!)).toMatchObject({
      state: "accepted",
      menu_version_id: f.version,
    })
    expect((await events(rows.dal!)).map((e) => e.action)).toEqual([
      "accepted",
      "carried",
    ])
    expect(
      (await events(rows.tikka!)).map((e) => [e.action, e.actor_role])
    ).toEqual([
      ["accepted", "manager"],
      ["needs_recheck", "system"],
    ])
    // korma, tikka, dal, lassi, biryani: only dal is still covered.
    expect(await totals(f.staff, f.venue)).toEqual({
      state: "ready",
      eligible: 5,
      covered: 1,
      recheck: 3,
    })
  })

  it("lists recheck rows as candidates again and accepts them with a fresh snapshot", async () => {
    const tikka = t(f.items["mains--tikka"]!)
    const candidates = await ok(
      f.manager.client.rpc("menu_item_photo_candidates", {
        p_venue_id: f.venue,
        p_item_id: tikka.itemId,
      })
    )
    expect(candidates).toEqual([
      expect.objectContaining({
        photo_id: rows.tikka,
        photo_state: "needs_recheck",
        item_name: "Paneer tikka",
      }),
    ])
    const asset = (await photo(rows.tikka!)).asset_id
    const [row] = await ok(
      review(f.manager, asset, tikka, "accepted", candidates[0]!.item_revision)
    )
    expect(row).toMatchObject({
      photo_id: rows.tikka,
      state: "accepted",
      is_primary: true,
    })
    expect(await photo(rows.tikka!)).toMatchObject({
      item_name: "Paneer tikka",
      recheck_kind: null,
    })
    // The removed Chicken variant cannot be reviewed on the new menu.
    const korma = t(f.items["mains--korma"]!, 0)
    const kormaAsset = (await photo(rows.korma!)).asset_id
    await fails(
      review(
        f.manager,
        kormaAsset,
        korma,
        "accepted",
        await head(korma.itemId)
      ),
      "menu_item_unavailable",
      "P0001"
    )
    // It is still listed (variant gone: variant_name null) so a reviewer
    // gets its photo id, and it counts as waiting until withdrawn.
    for (const reviewed of [false, true]) {
      const listed = await ok(
        f.manager.client.rpc("menu_item_photo_candidates", {
          p_venue_id: f.venue,
          p_item_id: korma.itemId,
          p_include_reviewed: reviewed,
        })
      )
      expect(listed).toEqual([
        expect.objectContaining({
          photo_id: rows.korma,
          photo_state: "needs_recheck",
          variant_id: korma.variantId,
          variant_name: null,
        }),
      ])
    }
    expect(await itemRow(f.manager, f.venue, korma.itemId)).toMatchObject({
      needs_recheck_count: 1,
      candidate_count: 1,
    })
    // The recheck can be withdrawn with a reason, which clears it.
    await ok(
      withdraw(
        f.manager,
        rows.korma!,
        await head(korma.itemId),
        "No longer served"
      )
    )
    expect((await photo(rows.korma!)).state).toBe("withdrawn")
    expect(await itemRow(f.manager, f.venue, korma.itemId)).toMatchObject({
      needs_recheck_count: 0,
      candidate_count: 0,
    })
  })

  it("counts a departed uploader's recheck only for admins", async () => {
    const g = await venueWithMenu("mip-departed")
    const dal = g.items["mains--dal"]!
    const asset = await labelled(g.staff2, g.version, [t(dal)])
    await accept(g.manager, asset.id, t(dal))
    const { error } = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", g.staff2.id)
    if (error) throw error
    await publishMenu(
      admin,
      g.venue,
      menu("TEST departed v2", [
        section("mains", "Mains", [
          item("mains--dal", "Tarka dal", { itemId: dal.itemId }),
        ]),
      ]),
      g.version
    )
    expect(await itemRow(g.manager, g.venue, dal.itemId)).toMatchObject({
      needs_recheck_count: 0,
    })
    expect((await totals(g.manager, g.venue)).recheck).toBe(0)
    expect(await itemRow(admin, g.venue, dal.itemId)).toMatchObject({
      needs_recheck_count: 1,
    })
  })
})

describe("separate measures and menu states", () => {
  it("leaves the monthly and section totals unchanged", async () => {
    const f = await venueWithMenu("mip-measures")
    const tikka = t(f.items["mains--tikka"]!)
    const asset = (await labelled(f.staff, f.version, [tikka])).id
    const read = async () => ({
      summary: await ok(
        f.manager.client.rpc("venue_coverage_summary", { p_venue_id: f.venue })
      ),
      month: await staffProgress(f.manager, f.venue, currentMonth()),
    })
    const before = await read()
    const accepted = await accept(f.manager, asset, tikka)
    expect(await read()).toEqual(before)
    await ok(
      withdraw(f.manager, accepted.photo_id, await head(tikka.itemId), "Undo")
    )
    expect(await read()).toEqual(before)
  })

  it("distinguishes no menu, an empty menu and a ready one", async () => {
    const bare = (await createVenue(service, "mip-nomenu")).id
    const bareStaff = await createIdentity(service, {
      label: "mip-nomenu-s",
      role: "staff",
      venueId: bare,
    })
    expect(await summary(bareStaff, null)).toEqual([
      expect.objectContaining({
        venue_id: bare,
        menu_state: "no_menu",
        menu_version_id: null,
        eligible_items: 0,
      }),
    ])
    expect(await ok(bareStaff.client.rpc("menu_item_photo_items", {}))).toEqual(
      []
    )

    const extrasOnly = (await createVenue(service, "mip-empty")).id
    const emptyStaff = await createIdentity(service, {
      label: "mip-empty-s",
      role: "staff",
      venueId: extrasOnly,
    })
    const version = await publishMenu(
      admin,
      extrasOnly,
      menu("TEST extras", [
        section(
          "extras",
          "Extras",
          [item("extras--card", "Gift card")],
          "other"
        ),
      ])
    )
    expect(await summary(emptyStaff, null)).toEqual([
      expect.objectContaining({
        menu_state: "empty",
        menu_version_id: version,
        section_id: null,
        eligible_items: 0,
      }),
    ])
  })
})
