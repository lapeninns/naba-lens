// Venue manager item-photo rules (20261107100300..100600): manager accounts
// read Our menu through definer functions only, never decide on their own
// photos, decide on active colleagues' photos (moved staff, converted
// managers' history) but not leavers' (admin-only), correct staff labels,
// assign photos labelled for an old menu or unlabelled food photos, and get
// counts that agree with the review queue. Real signed-in identities through
// PostgREST; the service role only builds fixtures, reads state back and
// probes guards.
import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  fails,
  legacyStaffGrant,
  makeManager,
  ok,
  requestKey,
} from "./coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveLabels,
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

const service = serviceClient()
let admin: TestIdentity
/** A manager account at a venue of its own (isolation probes). */
let mgrB: TestIdentity
let venueB: string

const N = null as unknown as string

type Tuple = { itemId: string; variantId: string | null }
const t = (row: CatalogueRow, variant?: number): Tuple => ({
  itemId: row.itemId,
  variantId: variant === undefined ? null : row.variants[variant]!.variantId,
})

const MENU = () =>
  menu("TEST manager photos", [
    section("mains", "Mains", [
      item("mains--korma", "Korma", { variants: ["Small", "Large"] }),
      item("mains--tikka", "Tikka"),
      item("mains--dal", "Dal"),
      item("mains--bhaji", "Bhaji"),
      item("mains--naan", "Naan", { variants: ["Plain", "Garlic"] }),
    ]),
    section("drinks", "Drinks", [item("drinks--lassi", "Lassi")], "drinks"),
  ])

type World = {
  venue: string
  version: string
  items: Record<string, CatalogueRow>
  staff1: TestIdentity
  staff2: TestIdentity
  mgr: TestIdentity
  /** The manager's photos uploaded and labelled while still staff. */
  history: Record<string, string>
}

const staff = (label: string, venueId: string) =>
  createIdentity(service, { label, role: "staff", venueId })

/**
 * A venue with an active menu, two staff members and a manager account
 * converted from staff after labelling `history` photos (key -> item key).
 */
async function world(
  label: string,
  history: Record<string, [string, number?]> = {}
): Promise<World> {
  const venue = (await createVenue(service, label)).id
  const version = await publishMenu(admin, venue, MENU())
  const items = (await readDocument(service, version)).byKey
  const [staff1, staff2, mgr] = await Promise.all([
    staff(`${label}-s1`, venue),
    staff(`${label}-s2`, venue),
    staff(`${label}-mgr`, venue),
  ])
  const photos: Record<string, string> = {}
  for (const [key, [itemKey, variant]] of Object.entries(history))
    photos[key] = (
      await labelled(mgr, version, [t(items[itemKey]!, variant)])
    ).id
  await makeManager(admin, mgr, venue)
  return { venue, version, items, staff1, staff2, mgr, history: photos }
}

/** A ready photo by `who`, labelled with the tuples (and content types). */
async function labelled(
  who: TestIdentity,
  version: string,
  tuples: Tuple[],
  types: string[] = ["dish"]
) {
  const asset = await reserveReady(service, who)
  const saved = await saveOk(who, {
    asset: asset.id,
    revision: 0,
    types,
    items: tuples,
    catalogue: version,
  })
  return { id: asset.id, revision: saved!.revision as number }
}

/** A ready photo with content types only (no item tuple). */
async function unlabelled(who: TestIdentity, types: string[] | null) {
  const asset = await reserveReady(service, who)
  if (types) await saveOk(who, { asset: asset.id, revision: 0, types })
  return asset.id
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
  decision: "accepted" | "better_photo_requested",
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

function assign(
  who: TestIdentity,
  asset: string,
  target: Tuple,
  corrects: Tuple | null,
  revision: number,
  opts: { reason?: string; primary?: boolean; key?: string } = {}
) {
  return who.client.rpc("assign_menu_item_photo", {
    p_asset_id: asset,
    p_item_id: target.itemId,
    p_variant_id: target.variantId as string,
    p_corrects_item_id: (corrects?.itemId ?? null) as string,
    p_corrects_variant_id: (corrects?.variantId ?? null) as string,
    p_reason: (opts.reason ?? null) as string,
    p_expected_revision: revision,
    p_make_primary: opts.primary ?? false,
    ...(opts.key ? { p_client_request_key: opts.key } : {}),
  })
}

async function assignOk(
  who: TestIdentity,
  asset: string,
  target: Tuple,
  corrects: Tuple | null,
  reason?: string
) {
  const [row] = await ok(
    assign(who, asset, target, corrects, await head(target.itemId), { reason })
  )
  return row!
}

function withdraw(
  who: TestIdentity,
  photo: string,
  revision: number,
  reason: string,
  key?: string
) {
  return who.client.rpc("withdraw_menu_item_photo", {
    p_photo_id: photo,
    p_expected_revision: revision,
    p_reason: reason,
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

type QueueStatus =
  | "pending"
  | "recheck"
  | "needs_another_photo"
  | "accepted"
  | "stale_label"
  | "unlabelled"
  | "mine"
  | "all"

async function queue(
  who: TestIdentity,
  venue: string | null,
  status: QueueStatus = "pending",
  opts: { itemId?: string; sectionId?: string; contributorId?: string } = {}
) {
  return ok(
    who.client.rpc("manager_menu_photo_queue", {
      ...(venue ? { p_venue_id: venue } : {}),
      p_status: status,
      ...(opts.itemId ? { p_item_id: opts.itemId } : {}),
      ...(opts.sectionId ? { p_section_id: opts.sectionId } : {}),
      ...(opts.contributorId ? { p_contributor_id: opts.contributorId } : {}),
      p_limit: 101,
    })
  )
}

async function overview(who: TestIdentity, venue: string | null) {
  const [row] = await ok(
    who.client.rpc(
      "manager_menu_photo_overview",
      venue ? { p_venue_id: venue } : {}
    )
  )
  return row!
}

async function items(who: TestIdentity, venue: string | null, status?: string) {
  return ok(
    who.client.rpc("manager_menu_photo_items", {
      ...(venue ? { p_venue_id: venue } : {}),
      ...(status ? { p_status: status } : {}),
      p_limit: 101,
    })
  )
}

const byItem = <T extends { item_id: string | null }>(
  rows: T[],
  itemId: string
) => rows.find((r) => r.item_id === itemId)!

async function photo(id: string) {
  const { data, error } = await service
    .from("menu_item_photos")
    .select("*")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

async function eventCount(photoId: string) {
  const { count, error } = await service
    .from("menu_item_photo_events")
    .select("id", { count: "exact", head: true })
    .eq("photo_id", photoId)
  if (error) throw error
  return count ?? 0
}

async function previewable(who: TestIdentity, asset: string) {
  return (
    (await ok(who.client.rpc("menu_item_photo_asset", { p_asset_id: asset })))
      .length === 1
  )
}

async function setProfile(
  id: string,
  values: { active?: boolean; venue_id?: string }
) {
  const { error } = await service.from("profiles").update(values).eq("id", id)
  if (error) throw error
}

/** Re-activates a version with the given items (keeps ids by source key). */
async function activateNext(
  w: { venue: string; items: Record<string, CatalogueRow> },
  title: string,
  entries: [string, string, "food" | "drinks"][],
  basedOn: string,
  extra: [string, string][] = []
) {
  const food = entries.filter((e) => e[2] === "food")
  const drinks = entries.filter((e) => e[2] === "drinks")
  const keep = (rows: typeof entries) =>
    rows.map(([key, name]) => {
      const row = w.items[key]!
      return item(key, name, { itemId: row.itemId, variants: row.variants })
    })
  return publishMenu(
    admin,
    w.venue,
    menu(title, [
      section("mains", "Mains", [
        ...keep(food),
        ...extra.map(([key, name]) => item(key, name)),
      ]),
      ...(drinks.length
        ? [section("drinks", "Drinks", keep(drinks), "drinks")]
        : []),
    ]),
    basedOn
  )
}

beforeAll(async () => {
  admin = await createIdentity(service, { label: "mgrph-admin", role: "admin" })
  venueB = (await createVenue(service, "mgrph-b")).id
  await publishMenu(admin, venueB, MENU())
  mgrB = await staff("mgrph-b-mgr", venueB)
  await makeManager(admin, mgrB, venueB)
})

describe("reading Our menu as a manager account", () => {
  let w: World
  let photoS: string
  let gA: TestIdentity

  beforeAll(async () => {
    w = await world("mgrph-read", { lassi: ["drinks--lassi"] })
    gA = await staff("mgrph-read-ga", w.venue)
    await legacyStaffGrant(service, admin, gA.id, w.venue)
    photoS = (
      await labelled(w.staff1, w.version, [t(w.items["mains--tikka"]!)])
    ).id
    await accept(w.mgr, photoS, t(w.items["mains--tikka"]!))
    await accept(admin, w.history.lassi!, t(w.items["drinks--lassi"]!))
  })

  it("read_venue_null_bypass: another venue's manager and an inactive account get venue_not_found", async () => {
    const inactive = await staff("mgrph-read-off", w.venue)
    await setProfile(inactive.id, { active: false })
    for (const who of [mgrB, inactive])
      for (const fn of [
        "menu_item_photo_summary",
        "menu_item_photo_items",
      ] as const)
        await fails(
          who.client.rpc(fn, { p_venue_id: w.venue }),
          "venue_not_found",
          "P0002"
        )
    await fails(
      inactive.client.rpc("menu_item_photo_summary", {}),
      "venue_not_found",
      "P0002"
    )
  })

  it("manager reads own venue summary/items, by default and by id", async () => {
    for (const venue of [null, w.venue]) {
      const rows = await ok(
        w.mgr.client.rpc(
          "menu_item_photo_summary",
          venue ? { p_venue_id: venue } : {}
        )
      )
      expect(rows[0]).toMatchObject({ venue_id: w.venue, menu_state: "ready" })
      expect(rows.reduce((n, r) => n + r.eligible_items, 0)).toBe(6)
      const list = await ok(
        w.mgr.client.rpc(
          "menu_item_photo_items",
          venue ? { p_venue_id: venue } : {}
        )
      )
      expect(byItem(list, w.items["mains--tikka"]!.itemId)).toMatchObject({
        covered: true,
      })
    }
    expect(await overview(w.mgr, null)).toMatchObject({
      venue_id: w.venue,
      menu_state: "ready",
      eligible_items: 6,
      covered_items: 2,
    })
  })

  it("manager cannot read tables, even rows it authored; legacy grantees and staff keep theirs", async () => {
    for (const table of [
      "menu_item_photos",
      "menu_item_photo_events",
    ] as const) {
      const { data, error } = await w.mgr.client.from(table).select("id")
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
    const legacy = await gA.client
      .from("menu_item_photos")
      .select("id")
      .eq("venue_id", w.venue)
    expect(legacy.data!.length).toBe(2)
    const legacyEvents = await gA.client
      .from("menu_item_photo_events")
      .select("id")
      .eq("venue_id", w.venue)
    expect(legacyEvents.data!.length).toBeGreaterThanOrEqual(2)
    const own = await w.staff1.client
      .from("menu_item_photos")
      .select("author_id")
    expect(own.data!.map((r) => r.author_id)).toEqual([w.staff1.id])
  })
})

describe("no self-review for manager accounts", () => {
  let w: World
  let mgrA2: TestIdentity

  beforeAll(async () => {
    w = await world("mgrph-self", {
      korma: ["mains--korma", 0],
      dal: ["mains--dal"],
      tikka: ["mains--tikka"],
      bhaji1: ["mains--bhaji"],
      bhaji2: ["mains--bhaji"],
      lassi: ["drinks--lassi"],
    })
    mgrA2 = await staff("mgrph-self-m2", w.venue)
    await makeManager(admin, mgrA2, w.venue)
  })

  it("self_review_not_allowed through review, assign, withdraw and set_menu_item_primary_photo", async () => {
    const korma = t(w.items["mains--korma"]!, 0)
    const tikka = t(w.items["mains--tikka"]!)
    for (const decision of ["accepted", "better_photo_requested"] as const)
      await fails(
        review(w.mgr, w.history.korma!, korma, decision, 1, { reason: "Mine" }),
        "self_review_not_allowed",
        "42501"
      )
    await fails(
      assign(w.mgr, w.history.korma!, tikka, korma, 1, { reason: "Wrong" }),
      "self_review_not_allowed",
      "42501"
    )
    const kormaRow = await accept(admin, w.history.korma!, korma)
    await fails(
      withdraw(w.mgr, kormaRow.photo_id, await head(korma.itemId), "Mine"),
      "self_review_not_allowed",
      "42501"
    )
    // W3 has no trigger behind it: the RPC check is the only guard.
    const dal = t(w.items["mains--dal"]!)
    const staffDal = (await labelled(w.staff1, w.version, [dal])).id
    await accept(admin, staffDal, dal)
    const own = await accept(admin, w.history.dal!, dal)
    expect(own.is_primary).toBe(false)
    await fails(
      setPrimary(w.mgr, own.photo_id, await head(dal.itemId)),
      "self_review_not_allowed",
      "42501"
    )
    expect((await photo(own.photo_id)).is_primary).toBe(false)
  })

  it("trigger blocks direct self decision; an admin's withdrawal still promotes the manager's photo", async () => {
    const tikka = w.items["mains--tikka"]!
    const insert = await service.from("menu_item_photos").insert({
      venue_id: w.venue,
      item_id: tikka.itemId,
      asset_id: w.history.tikka!,
      author_id: w.mgr.id,
      state: "accepted",
      item_name: "Tikka",
      section_name: "Mains",
      section_kind: "food",
      menu_version_id: w.version,
      decided_by: w.mgr.id,
      self_review: true,
    })
    expect(insert.error?.message).toBe("self_review_not_allowed")
    const accepted = await accept(admin, w.history.tikka!, t(tikka))
    const row = await photo(accepted.photo_id)
    const update = await service
      .from("menu_item_photos")
      .update({
        state: "withdrawn",
        reason: "Mine",
        is_primary: false,
        withdrawn_by: w.mgr.id,
        withdrawn_at: new Date().toISOString(),
        revision: row.revision + 1,
      })
      .eq("id", row.id)
    expect(update.error?.message).toBe("self_review_not_allowed")
    const reaccept = await service
      .from("menu_item_photos")
      .update({ decided_by: w.mgr.id, revision: row.revision + 1 })
      .eq("id", row.id)
    expect(reaccept.error?.message).toBe("self_review_not_allowed")

    const bhaji = t(w.items["mains--bhaji"]!)
    const first = await accept(admin, w.history.bhaji1!, bhaji)
    const second = await accept(admin, w.history.bhaji2!, bhaji)
    expect([first.is_primary, second.is_primary]).toEqual([true, false])
    const [out] = await ok(
      withdraw(admin, first.photo_id, await head(bhaji.itemId), "Blurry")
    )
    expect(out!.new_primary_photo_id).toBe(second.photo_id)
    expect((await photo(second.photo_id)).is_primary).toBe(true)
  })

  it("other reviewer can decide converted manager's photo", async () => {
    const lassi = t(w.items["drinks--lassi"]!)
    expect((await queue(mgrA2, null)).map((c) => c.asset_id)).toContain(
      w.history.lassi
    )
    expect((await queue(w.mgr, null)).map((c) => c.asset_id)).not.toContain(
      w.history.lassi
    )
    expect((await queue(w.mgr, null, "mine")).map((c) => c.asset_id)).toContain(
      w.history.lassi
    )
    const row = await accept(mgrA2, w.history.lassi!, lassi)
    expect(row).toMatchObject({ state: "accepted", self_review: false })
    expect(await photo(row.photo_id)).toMatchObject({
      author_id: w.mgr.id,
      decided_by: mgrA2.id,
    })
  })
})

describe("contributors who moved or left", () => {
  let w: World
  let moved: TestIdentity
  let left: TestIdentity
  let movedPhoto: string
  let leftPhoto: string

  beforeAll(async () => {
    w = await world("mgrph-people")
    ;[moved, left] = await Promise.all([
      staff("mgrph-people-moved", w.venue),
      staff("mgrph-people-left", w.venue),
    ])
    movedPhoto = (
      await labelled(moved, w.version, [t(w.items["mains--tikka"]!)])
    ).id
    leftPhoto = (await labelled(left, w.version, [t(w.items["mains--dal"]!)]))
      .id
    await setProfile(moved.id, { venue_id: venueB })
    await setProfile(left.id, { active: false })
  })

  it("moved contributors reviewable, leavers admin-only", async () => {
    const tikka = t(w.items["mains--tikka"]!)
    const dal = t(w.items["mains--dal"]!)
    const pending = await queue(w.mgr, null)
    const card = pending.find((c) => c.asset_id === movedPhoto)!
    expect(card).toMatchObject({
      contributor_status: "moved",
      can_follow_up: false,
    })
    expect(pending.map((c) => c.asset_id)).not.toContain(leftPhoto)
    expect(
      (await queue(w.mgr, null, "all")).map((c) => c.asset_id)
    ).not.toContain(leftPhoto)
    const dalRow = byItem(await items(w.mgr, null), dal.itemId)
    expect(dalRow).toMatchObject({
      status: "awaiting_review",
      candidate_count: 0,
      others_waiting: 1,
    })
    expect((await overview(w.mgr, null)).pending_photos).toBe(1)
    expect((await queue(admin, w.venue)).map((c) => c.asset_id)).toContain(
      leftPhoto
    )

    await accept(w.mgr, movedPhoto, tikka)
    await fails(
      review(w.mgr, leftPhoto, dal, "accepted", 1),
      "media_asset_not_found",
      "P0002"
    )
    for (const who of [mgrB])
      for (const asset of [movedPhoto, leftPhoto])
        await fails(
          review(who, asset, asset === movedPhoto ? tikka : dal, "accepted", 2),
          "media_asset_not_found",
          "P0002"
        )
    const adminRow = await accept(admin, leftPhoto, dal)
    // Every write keeps leavers' photos admin-only.
    await fails(
      withdraw(w.mgr, adminRow.photo_id, await head(dal.itemId), "No"),
      "menu_item_photo_not_found",
      "P0002"
    )
    await fails(
      setPrimary(w.mgr, adminRow.photo_id, await head(dal.itemId)),
      "menu_item_photo_not_found",
      "P0002"
    )
    const contributors = await ok(
      w.mgr.client.rpc("manager_menu_photo_contributors", {})
    )
    expect(contributors.map((c) => c.contributor_id)).toEqual([moved.id])
    expect(contributors[0]).toMatchObject({
      status: "moved",
      accepted_items: 1,
    })
    const adminContributors = await ok(
      admin.client.rpc("manager_menu_photo_contributors", {
        p_venue_id: w.venue,
      })
    )
    expect(new Set(adminContributors.map((c) => c.contributor_id))).toEqual(
      new Set([moved.id, left.id])
    )
  })
})

describe("venue isolation", () => {
  let w: World
  let asset: string
  let photoId: string

  beforeAll(async () => {
    w = await world("mgrph-iso")
    const tikka = t(w.items["mains--tikka"]!)
    asset = (await labelled(w.staff1, w.version, [tikka])).id
    photoId = (await accept(w.mgr, asset, tikka)).photo_id
  })

  it("venue isolation: venue reads refuse, id reads are empty, writes and previews are not found", async () => {
    const itemId = w.items["mains--tikka"]!.itemId
    const venueReads = [
      ["manager_menu_photo_overview", { p_venue_id: w.venue }],
      ["manager_menu_photo_items", { p_venue_id: w.venue }],
      ["manager_menu_photo_queue", { p_venue_id: w.venue }],
      ["manager_menu_photo_item", { p_venue_id: w.venue, p_item_id: itemId }],
      [
        "manager_menu_photo_item_events",
        { p_venue_id: w.venue, p_item_id: itemId },
      ],
      ["manager_menu_photo_contributors", { p_venue_id: w.venue }],
      [
        "manager_menu_photo_contributor",
        { p_venue_id: w.venue, p_contributor_id: w.staff1.id },
      ],
    ] as const
    for (const [fn, args] of venueReads)
      await fails(
        mgrB.client.rpc(fn, args as never) as never,
        "not_venue_manager",
        "42501"
      )
    // The caller's own venue with another venue's ids: nothing.
    expect(
      await ok(
        mgrB.client.rpc("manager_menu_photo_item", {
          p_venue_id: venueB,
          p_item_id: itemId,
        })
      )
    ).toEqual([])
    expect(
      await ok(
        mgrB.client.rpc("manager_menu_photo_item_events", {
          p_venue_id: venueB,
          p_item_id: itemId,
        })
      )
    ).toEqual([])
    expect(
      await ok(
        mgrB.client.rpc("manager_menu_photo_contributor", {
          p_venue_id: venueB,
          p_contributor_id: w.staff1.id,
        })
      )
    ).toEqual([])
    expect((await overview(mgrB, null)).venue_id).toBe(venueB)
    const tikka = t(w.items["mains--tikka"]!)
    await fails(
      review(mgrB, asset, tikka, "accepted", 2),
      "media_asset_not_found",
      "P0002"
    )
    await fails(
      assign(mgrB, asset, t(w.items["mains--dal"]!), tikka, 1, { reason: "x" }),
      "media_asset_not_found",
      "P0002"
    )
    await fails(
      withdraw(mgrB, photoId, 2, "No"),
      "menu_item_photo_not_found",
      "P0002"
    )
    await fails(
      setPrimary(mgrB, photoId, 2),
      "menu_item_photo_not_found",
      "P0002"
    )
    expect(await previewable(mgrB, asset)).toBe(false)
    // Staff: the manager reads are for venue managers only.
    await fails(
      w.staff1.client.rpc("manager_menu_photo_overview", {}),
      "not_venue_manager",
      "42501"
    )
  })
})

describe("choosing a different menu item", () => {
  let w: World
  let tikka: Tuple
  let dal: Tuple
  let bhaji: Tuple

  beforeAll(async () => {
    w = await world("mgrph-relink")
    tikka = t(w.items["mains--tikka"]!)
    dal = t(w.items["mains--dal"]!)
    bhaji = t(w.items["mains--bhaji"]!)
  })

  const pendingAssets = async (itemId: string) =>
    (await queue(w.mgr, null, "pending", { itemId })).map((c) => c.asset_id)

  it("relink: moves the photo, keeps the staff label, and can be undone", async () => {
    const p = await labelled(w.staff1, w.version, [tikka])
    expect(await pendingAssets(tikka.itemId)).toEqual([p.id])
    const row = await assignOk(w.mgr, p.id, dal, tikka, "Wrong dish")
    expect(row).toMatchObject({
      state: "accepted",
      is_primary: true,
      replayed: false,
    })
    expect(await photo(row.photo_id)).toMatchObject({
      basis: "reviewer",
      item_id: dal.itemId,
      corrects_item_id: tikka.itemId,
      corrects_variant_id: null,
      reason: "Wrong dish",
    })
    expect(byItem(await items(w.mgr, null), dal.itemId)).toMatchObject({
      covered: true,
    })
    expect(await pendingAssets(tikka.itemId)).toEqual([])
    expect(
      (
        await ok(
          w.mgr.client.rpc("menu_item_photo_candidates", {
            p_item_id: tikka.itemId,
          })
        )
      ).map((c) => c.asset_id)
    ).toEqual([])
    const { data: labels } = await service
      .from("media_label_items")
      .select("item_id")
      .eq("asset_id", p.id)
    expect(labels).toEqual([{ item_id: tikka.itemId }])
    // The staff label is refused for review while the correction stands.
    await fails(
      review(w.mgr, p.id, tikka, "accepted", await head(tikka.itemId)),
      "menu_item_relinked",
      "P0001"
    )
    const accepted = await queue(w.mgr, null, "accepted", {
      itemId: dal.itemId,
    })
    expect(accepted).toEqual([
      expect.objectContaining({
        kind: "decided",
        photo_id: row.photo_id,
        basis: "reviewer",
        corrects_item_id: tikka.itemId,
        corrects_item_name: "Tikka",
        staff_label: [
          expect.objectContaining({ itemId: tikka.itemId, onMenu: true }),
        ],
      }),
    ])
    // A staff re-save of the label (remove, add again) brings it back.
    const cleared = await saveOk(w.staff1, {
      asset: p.id,
      revision: p.revision,
      types: ["dish"],
      items: [],
      catalogue: w.version,
    })
    await saveOk(w.staff1, {
      asset: p.id,
      revision: cleared!.revision as number,
      types: ["dish"],
      items: [tikka],
      catalogue: w.version,
    })
    expect(await pendingAssets(tikka.itemId)).toEqual([p.id])

    // Withdrawing a mistaken correction brings the label back; a new one succeeds.
    const p2 = await labelled(w.staff2, w.version, [tikka])
    const moved = await assignOk(w.mgr, p2.id, dal, tikka, "Looks like dal")
    expect(await pendingAssets(tikka.itemId)).not.toContain(p2.id)
    await ok(
      withdraw(w.mgr, moved.photo_id, await head(dal.itemId), "My mistake")
    )
    expect(await pendingAssets(tikka.itemId)).toContain(p2.id)
    const again = await assignOk(w.mgr, p2.id, bhaji, tikka, "It is bhaji")
    expect(again.state).toBe("accepted")
  })

  it("relink requires label and reason; refused when X tuple accepted, better_photo_requested or needs_recheck", async () => {
    const lassi = t(w.items["drinks--lassi"]!)
    const p = await labelled(w.staff1, w.version, [tikka])
    await fails(
      assign(w.mgr, p.id, dal, lassi, await head(dal.itemId), { reason: "x" }),
      "relink_requires_label",
      "P0001"
    )
    await fails(
      assign(w.mgr, p.id, dal, tikka, await head(dal.itemId)),
      "reason_required",
      "22023"
    )
    // The staff label itself cannot be the target: use review.
    await fails(
      assign(w.mgr, p.id, tikka, tikka, await head(tikka.itemId), {
        reason: "x",
      }),
      "menu_item_labelled",
      "P0001"
    )
    const accepted = await accept(w.mgr, p.id, tikka)
    const refused = await fails(
      assign(w.mgr, p.id, dal, tikka, await head(dal.itemId), { reason: "x" }),
      "invalid_transition",
      "P0001"
    )
    expect(refused.details).toBe("withdraw first")
    const better = await labelled(w.staff2, w.version, [tikka])
    await ok(
      review(
        w.mgr,
        better.id,
        tikka,
        "better_photo_requested",
        await head(tikka.itemId),
        {
          reason: "Too dark",
        }
      )
    )
    await fails(
      assign(w.mgr, better.id, dal, tikka, await head(dal.itemId), {
        reason: "x",
      }),
      "invalid_transition",
      "P0001"
    )
    // A staff-label row sent for a recheck (as activation does) also stands.
    const row = await photo(accepted.photo_id)
    const { error } = await service
      .from("menu_item_photos")
      .update({
        state: "needs_recheck",
        recheck_kind: "name_changed",
        is_primary: false,
        revision: row.revision + 1,
      })
      .eq("id", row.id)
    if (error) throw error
    await fails(
      assign(w.mgr, p.id, dal, tikka, await head(dal.itemId), { reason: "x" }),
      "invalid_transition",
      "P0001"
    )
  })

  it("option-only relink X/small -> X/large succeeds; corrects_variant FK rejects a variant of another item", async () => {
    const korma = w.items["mains--korma"]!
    const small = t(korma, 0)
    const large = t(korma, 1)
    const p = await labelled(w.staff1, w.version, [small])
    const row = await assignOk(w.mgr, p.id, large, small, "It is the large one")
    expect(row.corrects_item_revision).toBe(row.item_revision)
    expect(await photo(row.photo_id)).toMatchObject({
      item_id: korma.itemId,
      variant_id: large.variantId,
      corrects_item_id: korma.itemId,
      corrects_variant_id: small.variantId,
    })
    const naan = w.items["mains--naan"]!
    const other = await labelled(w.staff2, w.version, [small])
    const { error } = await service.from("menu_item_photos").insert({
      venue_id: w.venue,
      item_id: w.items["mains--dal"]!.itemId,
      asset_id: other.id,
      author_id: w.staff2.id,
      state: "accepted",
      item_name: "Dal",
      section_name: "Mains",
      section_kind: "food",
      menu_version_id: w.version,
      decided_by: admin.id,
      self_review: false,
      basis: "reviewer",
      corrects_item_id: korma.itemId,
      corrects_variant_id: naan.variants[0]!.variantId,
    })
    expect(error?.code).toBe("23503")
  })

  it("label removal does not invalidate reviewer rows; label removal invalidates staff-label rows", async () => {
    const lassi = t(w.items["drinks--lassi"]!)
    const p = await labelled(w.staff1, w.version, [tikka, lassi])
    const moved = await assignOk(w.mgr, p.id, bhaji, tikka, "It is bhaji")
    const kept = await accept(w.mgr, p.id, lassi)
    await saveOk(w.staff1, {
      asset: p.id,
      revision: p.revision,
      types: ["dish"],
      items: [],
      catalogue: w.version,
    })
    expect((await photo(moved.photo_id)).state).toBe("accepted")
    expect(await photo(kept.photo_id)).toMatchObject({
      state: "invalidated",
      invalidation_kind: "label_removed",
    })
  })
})

describe("rechecks, old-menu labels and reviewer rows after a menu change", () => {
  let w: World
  let reviewerRow: string
  let unlabelledRow: string
  let q: string
  let u: string
  let stale: string

  beforeAll(async () => {
    w = await world("mgrph-recheck")
    const tikka = t(w.items["mains--tikka"]!)
    q = (await labelled(w.staff1, w.version, [tikka])).id
    reviewerRow = (
      await assignOk(w.mgr, q, t(w.items["mains--dal"]!), tikka, "It is dal")
    ).photo_id
    u = await unlabelled(w.staff2, ["dish"])
    unlabelledRow = (
      await assignOk(w.mgr, u, t(w.items["mains--bhaji"]!), null)
    ).photo_id
    stale = (await labelled(w.staff2, w.version, [tikka])).id
    // V2: dal and bhaji renamed, tikka dropped.
    await activateNext(
      w,
      "TEST manager photos v2",
      [
        ["mains--korma", "Korma", "food"],
        ["mains--dal", "Tarka dal", "food"],
        ["mains--bhaji", "Onion bhaji", "food"],
        ["mains--naan", "Naan", "food"],
        ["drinks--lassi", "Lassi", "drinks"],
      ],
      w.version
    )
  })

  it("reviewer row recheck -> reaccept, for corrected and unlabelled rows", async () => {
    const dal = t(w.items["mains--dal"]!)
    const bhaji = t(w.items["mains--bhaji"]!)
    expect(await photo(reviewerRow)).toMatchObject({
      state: "needs_recheck",
      recheck_kind: "name_changed",
    })
    const recheck = await queue(w.mgr, null, "recheck")
    expect(recheck.map((c) => [c.kind, c.photo_id]).sort()).toEqual(
      [
        ["decided", reviewerRow],
        ["decided", unlabelledRow],
      ].sort()
    )
    const ov = await overview(w.mgr, null)
    expect(ov.needs_recheck_items).toBe(
      new Set(recheck.map((c) => c.item_id)).size
    )
    expect(ov.needs_recheck_items).toBe(2)
    await fails(
      assign(w.mgr, q, dal, null, await head(dal.itemId)),
      "corrects_mismatch",
      "22023"
    )
    const back = await assignOk(w.mgr, q, dal, t(w.items["mains--tikka"]!))
    expect(back).toMatchObject({
      photo_id: reviewerRow,
      state: "accepted",
      is_primary: true,
    })
    expect(await photo(reviewerRow)).toMatchObject({
      state: "accepted",
      item_name: "Tarka dal",
      reason: "It is dal",
    })
    const again = await assignOk(w.mgr, u, bhaji, null)
    expect(again).toMatchObject({ photo_id: unlabelledRow, state: "accepted" })
    expect(await queue(w.mgr, null, "recheck")).toEqual([])
  })

  it("stale label: listed with onMenu=false, assigned without a reason, then leaves the list", async () => {
    const listed = await queue(w.mgr, null, "stale_label")
    expect(listed).toEqual([
      expect.objectContaining({
        kind: "stale",
        asset_id: stale,
        item_id: null,
        staff_label: [
          expect.objectContaining({
            itemId: w.items["mains--tikka"]!.itemId,
            onMenu: false,
          }),
        ],
      }),
    ])
    expect((await queue(w.mgr, null, "all")).map((c) => c.asset_id)).toContain(
      stale
    )
    const korma = t(w.items["mains--korma"]!, 0)
    const row = await assignOk(w.mgr, stale, korma, t(w.items["mains--tikka"]!))
    expect(row.state).toBe("accepted")
    expect(byItem(await items(w.mgr, null), korma.itemId)).toMatchObject({
      covered: true,
    })
    expect(await queue(w.mgr, null, "stale_label")).toEqual([])
  })
})

describe("a reviewer recheck the uploader also labelled", () => {
  let w: World
  /** Unlabelled, assigned to korma/Small, then labelled korma/Small by staff. */
  let both: string
  let bothRow: string
  /** Labelled tikka, corrected to dal by the manager; never labelled dal. */
  let corrected: string
  let correctedRow: string

  beforeAll(async () => {
    w = await world("mgrph-dedupe")
    const kormaSmall = t(w.items["mains--korma"]!, 0)
    const tikka = t(w.items["mains--tikka"]!)
    both = await reserveReady(service, w.staff1).then((a) => a.id)
    const first = await saveOk(w.staff1, {
      asset: both,
      revision: 0,
      types: ["dish"],
    })
    bothRow = (await assignOk(w.mgr, both, kormaSmall, null)).photo_id
    await saveOk(w.staff1, {
      asset: both,
      revision: first!.revision as number,
      types: ["dish"],
      items: [kormaSmall],
      catalogue: w.version,
    })
    corrected = (await labelled(w.staff2, w.version, [tikka])).id
    correctedRow = (
      await assignOk(
        w.mgr,
        corrected,
        t(w.items["mains--dal"]!),
        tikka,
        "It is dal"
      )
    ).photo_id
    // V2: korma and dal renamed; both reviewer rows need a recheck.
    await activateNext(
      w,
      "TEST manager photos dedupe v2",
      [
        ["mains--korma", "Chicken korma", "food"],
        ["mains--tikka", "Tikka", "food"],
        ["mains--dal", "Tarka dal", "food"],
        ["mains--bhaji", "Bhaji", "food"],
        ["mains--naan", "Naan", "food"],
        ["drinks--lassi", "Lassi", "drinks"],
      ],
      w.version
    )
  })

  it("review_queue_dedupe: one card per recheck in every set, page and count", async () => {
    expect(await photo(bothRow)).toMatchObject({
      state: "needs_recheck",
      basis: "reviewer",
      corrects_item_id: null,
    })
    expect(await photo(correctedRow)).toMatchObject({
      state: "needs_recheck",
      basis: "reviewer",
      corrects_item_id: w.items["mains--tikka"]!.itemId,
    })
    const korma = w.items["mains--korma"]!.itemId
    const dal = w.items["mains--dal"]!.itemId
    const cards = (rows: { photo_id: string | null }[], id: string) =>
      rows.filter((c) => c.photo_id === id)

    for (const status of ["recheck", "all"] as const) {
      const rows = await queue(w.mgr, null, status)
      expect(cards(rows, bothRow), status).toHaveLength(1)
      expect(cards(rows, correctedRow), status).toHaveLength(1)
      expect(cards(rows, bothRow)[0], status).toMatchObject({
        kind: "labelled",
        item_id: korma,
        photo_state: "needs_recheck",
        basis: "reviewer",
        group_count: 0,
      })
      expect(cards(rows, correctedRow)[0], status).toMatchObject({
        kind: "decided",
        item_id: dal,
        corrects_item_id: w.items["mains--tikka"]!.itemId,
        group_count: 0,
      })
      expect(
        rows.filter((c) => c.item_id === korma),
        status
      ).toHaveLength(1)
      expect(
        rows.filter((c) => c.item_id === dal),
        status
      ).toHaveLength(1)
      // The item filter: the same single card.
      expect(
        (await queue(w.mgr, null, status, { itemId: korma })).map(
          (c) => c.photo_id
        ),
        status
      ).toEqual([bothRow])
    }
    // Pending holds the staff-labelled tuple only, once.
    const pending = await queue(w.mgr, null, "pending")
    expect(cards(pending, bothRow)).toHaveLength(1)
    expect(cards(pending, correctedRow)).toHaveLength(0)

    // Keyset pages of one: every card once.
    const keys: string[] = []
    const photos: (string | null)[] = []
    let after: { created_at: string; sort_key: string } | null = null
    for (let i = 0; i < 20; i++) {
      const [card]: {
        created_at: string
        sort_key: string
        photo_id: string | null
      }[] = await ok(
        w.mgr.client.rpc("manager_menu_photo_queue", {
          p_status: "all",
          p_limit: 1,
          ...(after
            ? {
                p_after_created_at: after.created_at,
                p_after_key: after.sort_key,
              }
            : {}),
        })
      )
      if (!card) break
      keys.push(card.sort_key)
      photos.push(card.photo_id)
      after = card
    }
    expect(new Set(keys).size).toBe(keys.length)
    expect(photos.filter((id) => id === bothRow)).toHaveLength(1)
    expect(keys.length).toBe((await queue(w.mgr, null, "all")).length)

    const ov = await overview(w.mgr, null)
    expect(ov.needs_recheck_items).toBe(2)
    expect(ov.needs_recheck_items).toBe(
      new Set((await queue(w.mgr, null, "recheck")).map((c) => c.item_id)).size
    )
    expect(ov.pending_photos).toBe(pending.length)
    const list = await items(w.mgr, null)
    expect(byItem(list, korma)).toMatchObject({
      needs_recheck_count: 1,
      candidate_count: 1,
    })
    expect(byItem(list, dal)).toMatchObject({
      needs_recheck_count: 1,
      candidate_count: 0,
    })
    const [detail] = await ok(
      w.mgr.client.rpc("manager_menu_photo_item", {
        p_venue_id: w.venue,
        p_item_id: korma,
      })
    )
    expect((detail!.photos as unknown[]).length).toBe(1)
  })
})

describe("unlabelled photos", () => {
  let w: World
  let gA: TestIdentity

  beforeAll(async () => {
    w = await world("mgrph-unlabelled")
    gA = await staff("mgrph-unl-ga", w.venue)
    await legacyStaffGrant(service, admin, gA.id, w.venue)
  })

  it("unlabelled: food-tagged photos only, for manager accounts and admins", async () => {
    const dish = await unlabelled(w.staff1, ["dish"])
    const team = await unlabelled(w.staff1, ["team"])
    const none = await unlabelled(w.staff1, [])
    const bare = await unlabelled(w.staff1, null)
    const spare = await unlabelled(w.staff2, ["drinks"])
    const listed = (await queue(w.mgr, null, "unlabelled")).map(
      (c) => c.asset_id
    )
    expect(listed.sort()).toEqual([dish, spare].sort())
    for (const asset of [team, none, bare]) expect(listed).not.toContain(asset)
    expect(await queue(gA, w.venue, "unlabelled")).toEqual([])
    expect(await previewable(w.mgr, spare)).toBe(true)
    expect(await previewable(admin, spare)).toBe(true)
    expect(await previewable(gA, spare)).toBe(false)
    expect(await previewable(w.staff2, dish)).toBe(false)
    expect(await previewable(w.mgr, team)).toBe(false)

    const tikka = t(w.items["mains--tikka"]!)
    await fails(
      assign(gA, spare, tikka, null, await head(tikka.itemId)),
      "not_venue_manager",
      "42501"
    )
    await fails(
      assign(w.mgr, team, tikka, null, await head(tikka.itemId)),
      "evidence_not_eligible",
      "P0001"
    )
    // heads with no correction: only the target head moves.
    const dal = t(w.items["mains--dal"]!)
    const before = {
      tikka: await head(tikka.itemId),
      dal: await head(dal.itemId),
    }
    const row = await assignOk(w.mgr, dish, tikka, null)
    expect(row).toMatchObject({
      state: "accepted",
      is_primary: true,
      item_revision: before.tikka + 1,
      corrects_item_revision: null,
    })
    expect(await head(tikka.itemId)).toBe(before.tikka + 1)
    expect(await head(dal.itemId)).toBe(before.dal)
    expect(
      (await queue(w.mgr, null, "unlabelled")).map((c) => c.asset_id)
    ).toEqual([spare])
    // One photo, several items: a second decision.
    const second = await assignOk(w.mgr, dish, dal, null)
    expect(second.photo_id).not.toBe(row.photo_id)
    // Staff see it once it is an item's menu photo.
    expect(await previewable(w.staff2, dish)).toBe(true)
    // A labelled photo is not "unlabelled".
    const p = await labelled(w.staff1, w.version, [tikka])
    await fails(
      assign(w.mgr, p.id, dal, null, await head(dal.itemId)),
      "asset_has_labels",
      "P0001"
    )
  })
})

describe("contributors with only unlabelled photos", () => {
  let w: World
  let gA: TestIdentity
  let onlyDish: TestIdentity
  let onlyTeam: TestIdentity
  let dishPhoto: string

  beforeAll(async () => {
    w = await world("mgrph-unl-people")
    ;[gA, onlyDish, onlyTeam] = await Promise.all([
      staff("mgrph-unl-people-ga", w.venue),
      staff("mgrph-unl-people-dish", w.venue),
      staff("mgrph-unl-people-team", w.venue),
    ])
    await legacyStaffGrant(service, admin, gA.id, w.venue)
    await labelled(w.staff1, w.version, [t(w.items["mains--tikka"]!)])
    dishPhoto = await unlabelled(onlyDish, ["dish"])
    await unlabelled(onlyTeam, ["team"])
  })

  const ids = (rows: { contributor_id: string }[]) =>
    rows.map((r) => r.contributor_id)

  it("unlabelled-only contributors: listed and found for managers and admins, as the queue shows them", async () => {
    const contributors = await ok(
      w.mgr.client.rpc("manager_menu_photo_contributors", {})
    )
    expect(ids(contributors)).toContain(onlyDish.id)
    expect(ids(contributors)).toContain(w.staff1.id)
    expect(ids(contributors)).not.toContain(onlyTeam.id)
    const [one, ...rest] = await ok(
      w.mgr.client.rpc("manager_menu_photo_contributor", {
        p_venue_id: w.venue,
        p_contributor_id: onlyDish.id,
      })
    )
    expect(rest).toEqual([])
    expect(one).toMatchObject({
      contributor_id: onlyDish.id,
      status: "here",
      labelled_photos: 0,
      accepted_items: 0,
      open_follow_ups: 0,
    })
    expect(one!.last_upload_at).not.toBeNull()
    // The Review queue's contributor filter shows the same photo.
    expect(
      (
        await queue(w.mgr, null, "unlabelled", { contributorId: onlyDish.id })
      ).map((c) => c.asset_id)
    ).toEqual([dishPhoto])

    const adminContributors = await ok(
      admin.client.rpc("manager_menu_photo_contributors", {
        p_venue_id: w.venue,
      })
    )
    expect(ids(adminContributors)).toContain(onlyDish.id)
    expect(ids(adminContributors)).not.toContain(onlyTeam.id)
    expect(
      await ok(
        admin.client.rpc("manager_menu_photo_contributor", {
          p_venue_id: w.venue,
          p_contributor_id: onlyDish.id,
        })
      )
    ).toHaveLength(1)
  })

  it("unlabelled-only contributors: hidden from legacy staff grantees; team-only uploaders hidden from everyone", async () => {
    const grantee = await ok(
      gA.client.rpc("manager_menu_photo_contributors", { p_venue_id: w.venue })
    )
    expect(ids(grantee)).toEqual([w.staff1.id])
    expect(
      await ok(
        gA.client.rpc("manager_menu_photo_contributor", {
          p_venue_id: w.venue,
          p_contributor_id: onlyDish.id,
        })
      )
    ).toEqual([])
    for (const who of [w.mgr, admin])
      expect(
        await ok(
          who.client.rpc("manager_menu_photo_contributor", {
            p_venue_id: w.venue,
            p_contributor_id: onlyTeam.id,
          })
        )
      ).toEqual([])
  })
})

describe("replays and conflicts", () => {
  let w: World

  beforeAll(async () => {
    w = await world("mgrph-replay")
  })

  it("idempotent replay for each write; reused keys and NULL ids are refused", async () => {
    const tikka = t(w.items["mains--tikka"]!)
    const dal = t(w.items["mains--dal"]!)
    const p = await labelled(w.staff1, w.version, [tikka])
    const key = requestKey()
    const [first] = await ok(review(w.mgr, p.id, tikka, "accepted", 1, { key }))
    const events = await eventCount(first!.photo_id)
    const [again] = await ok(review(w.mgr, p.id, tikka, "accepted", 1, { key }))
    expect(again).toMatchObject({ photo_id: first!.photo_id, replayed: true })
    expect(await eventCount(first!.photo_id)).toBe(events)
    await fails(
      w.mgr.client.rpc("review_menu_item_photo", {
        p_asset_id: N,
        p_item_id: tikka.itemId,
        p_variant_id: N,
        p_decision: "accepted",
        p_expected_revision: 1,
        p_client_request_key: key,
      }),
      "idempotency_key_reused",
      "22023"
    )

    const q = await labelled(w.staff2, w.version, [tikka])
    const aKey = requestKey()
    const [assigned] = await ok(
      assign(w.mgr, q.id, dal, tikka, 1, { reason: "Dal", key: aKey })
    )
    expect(assigned!.corrects_item_revision).toBe(await head(tikka.itemId))
    const [replayed] = await ok(
      assign(w.mgr, q.id, dal, tikka, 1, { reason: "Dal", key: aKey })
    )
    expect(replayed).toMatchObject({
      photo_id: assigned!.photo_id,
      replayed: true,
      item_revision: assigned!.item_revision,
      corrects_item_revision: assigned!.corrects_item_revision,
    })
    expect(await eventCount(assigned!.photo_id)).toBe(1)
    await fails(
      assign(
        w.mgr,
        q.id,
        dal,
        {
          itemId: tikka.itemId,
          variantId: w.items["mains--korma"]!.variants[0]!.variantId,
        },
        1,
        { reason: "Dal", key: aKey }
      ),
      "idempotency_key_reused",
      "22023"
    )
    await fails(
      assign(w.mgr, q.id, dal, tikka, 1, {
        reason: "Dal",
        key: aKey,
        primary: true,
      }),
      "idempotency_key_reused",
      "22023"
    )
    await fails(
      review(w.mgr, q.id, dal, "accepted", 1, { key: aKey }),
      "idempotency_key_reused",
      "22023"
    )

    // Withdraw and set primary: replay, and a NULL id never replays.
    const r = await labelled(w.staff1, w.version, [dal])
    const second = await accept(w.mgr, r.id, dal)
    const pKey = requestKey()
    const [set] = await ok(
      setPrimary(w.mgr, second.photo_id, await head(dal.itemId), pKey)
    )
    expect(
      (await ok(setPrimary(w.mgr, second.photo_id, 1, pKey)))[0]
    ).toMatchObject({
      replayed: true,
      item_revision: set!.item_revision,
    })
    await fails(
      setPrimary(w.mgr, N, 1, pKey),
      "idempotency_key_reused",
      "22023"
    )
    const wKey = requestKey()
    await ok(
      withdraw(w.mgr, second.photo_id, await head(dal.itemId), "Blurry", wKey)
    )
    expect(
      (await ok(withdraw(w.mgr, second.photo_id, 1, "Blurry", wKey)))[0]
    ).toMatchObject({
      replayed: true,
    })
    await fails(
      withdraw(w.mgr, N, 1, "Blurry", wKey),
      "idempotency_key_reused",
      "22023"
    )
  })

  it("stale revision: the second of two concurrent decisions gets coverage_conflict", async () => {
    const lassi = t(w.items["drinks--lassi"]!)
    const [a, b] = await Promise.all([
      labelled(w.staff1, w.version, [lassi]),
      labelled(w.staff2, w.version, [lassi]),
    ])
    const revision = await head(lassi.itemId)
    const results = await Promise.all([
      review(w.mgr, a.id, lassi, "accepted", revision),
      review(admin, b.id, lassi, "accepted", revision),
    ])
    const errors = results.filter((r) => r.error)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.error).toMatchObject({
      message: "coverage_conflict",
      code: "40001",
    })
    expect(JSON.parse(errors[0]!.error!.details!)).toEqual({
      revision: revision + 1,
    })
  })
})

describe("counts agree", () => {
  let w: World
  let left: TestIdentity

  beforeAll(async () => {
    w = await world("mgrph-counts", { bhaji: ["mains--bhaji"] })
    left = await staff("mgrph-counts-left", w.venue)
    await labelled(w.staff1, w.version, [t(w.items["mains--tikka"]!)])
    await labelled(w.staff2, w.version, [t(w.items["mains--tikka"]!)])
    await labelled(w.staff2, w.version, [t(w.items["mains--dal"]!)])
    await labelled(left, w.version, [t(w.items["drinks--lassi"]!)])
    await setProfile(left.id, { active: false })
    const korma = t(w.items["mains--korma"]!, 0)
    const k = await labelled(w.staff1, w.version, [korma])
    await accept(admin, k.id, korma)
    await labelled(w.staff2, w.version, [t(w.items["mains--korma"]!, 1)])
  })

  it("counts agree between overview, items and queue, and the headline is caller-independent", async () => {
    const ov = await overview(w.mgr, null)
    const pending = await queue(w.mgr, null)
    const list = await items(w.mgr, null)
    expect(ov.pending_photos).toBe(pending.length)
    expect(ov.pending_photos).toBe(
      list.reduce((n, r) => n + r.candidate_count, 0)
    )
    expect(ov.pending_photos).toBe(4) // tikka x2, dal, korma/Large
    expect(ov.own_waiting_photos).toBe(
      (await queue(w.mgr, null, "mine")).length
    )
    expect(ov.own_waiting_photos).toBe(1)
    expect(ov.needs_recheck_items).toBe(
      new Set((await queue(w.mgr, null, "recheck")).map((c) => c.item_id)).size
    )
    expect(ov).toMatchObject({
      eligible_items: 6,
      covered_items: 1,
      awaiting_review_items: 4, // tikka, dal, bhaji (own), lassi (leaver)
      needs_photo_items: 1, // naan
      replacement_pending_items: 1, // korma
    })
    const tikkaCards = pending.filter(
      (c) => c.item_id === w.items["mains--tikka"]!.itemId
    )
    expect(tikkaCards.map((c) => c.group_count)).toEqual([1, 1])

    const adminOv = await overview(admin, w.venue)
    for (const key of [
      "eligible_items",
      "covered_items",
      "awaiting_review_items",
      "needs_photo_items",
      "replacement_pending_items",
    ] as const)
      expect(adminOv[key], key).toBe(ov[key])
    expect(adminOv.pending_photos).toBe(6)
    expect(adminOv.own_waiting_photos).toBe(0)
    const adminList = await items(admin, w.venue)
    for (const row of list)
      expect(byItem(adminList, row.item_id!).status, row.name).toBe(row.status)
    expect(byItem(list, w.items["mains--bhaji"]!.itemId)).toMatchObject({
      status: "awaiting_review",
      candidate_count: 0,
      own_waiting: 1,
      others_waiting: 0,
    })
    expect(byItem(list, w.items["drinks--lassi"]!.itemId)).toMatchObject({
      status: "awaiting_review",
      own_waiting: 0,
      others_waiting: 1,
    })
    expect(byItem(list, w.items["mains--korma"]!.itemId)).toMatchObject({
      status: "covered",
      has_pending_replacement: true,
    })
    expect(
      (await items(w.mgr, null, "replacement")).map((r) => r.item_id)
    ).toEqual([w.items["mains--korma"]!.itemId])
    expect(
      (await items(w.mgr, null, "needs_photo")).map((r) => r.item_id)
    ).toEqual([w.items["mains--naan"]!.itemId])
    await fails(
      w.mgr.client.rpc("manager_menu_photo_items", { p_status: "nope" }),
      "invalid_status",
      "22023"
    )
    await fails(
      w.mgr.client.rpc("manager_menu_photo_queue", { p_status: "nope" }),
      "invalid_status",
      "22023"
    )
    // Contributor filter and one item.
    expect(
      (await queue(w.mgr, null, "all", { contributorId: w.staff2.id })).every(
        (c) => c.uploader_id === w.staff2.id
      )
    ).toBe(true)
    const [detail] = await ok(
      w.mgr.client.rpc("manager_menu_photo_item", {
        p_venue_id: w.venue,
        p_item_id: w.items["mains--korma"]!.itemId,
      })
    )
    expect(detail).toMatchObject({
      status: "covered",
      covered: true,
      preferred_is_fallback: false,
    })
    expect((detail!.photos as unknown[]).length).toBe(1)
    const history = await ok(
      w.mgr.client.rpc("manager_menu_photo_item_events", {
        p_venue_id: w.venue,
        p_item_id: w.items["mains--korma"]!.itemId,
      })
    )
    expect(history.map((e) => e.action)).toEqual(["accepted"])
    expect(Object.keys(history[0]!)).not.toContain("client_request_key")
  })
})

describe("menu activation", () => {
  it("activation: carried, rechecked and new items, against the version this activation retired", async () => {
    const w = await world("mgrph-activate")
    const tikka = t(w.items["mains--tikka"]!)
    const dal = t(w.items["mains--dal"]!)
    await accept(
      w.mgr,
      (await labelled(w.staff1, w.version, [tikka])).id,
      tikka
    )
    await accept(w.mgr, (await labelled(w.staff1, w.version, [dal])).id, dal)
    const v2 = await activateNext(
      w,
      "TEST manager photos v2",
      [
        ["mains--korma", "Korma", "food"],
        ["mains--tikka", "Paneer tikka", "food"],
        ["mains--dal", "Dal", "food"],
        ["mains--bhaji", "Bhaji", "food"],
        ["mains--naan", "Naan", "food"],
        ["drinks--lassi", "Lassi", "drinks"],
      ],
      w.version,
      [["mains--biryani", "Biryani"]]
    )
    expect(await overview(w.mgr, null)).toMatchObject({
      menu_version_id: v2,
      menu_title: "TEST manager photos v2",
      carried_items: 1,
      needs_recheck_items: 1,
      new_items: 1,
    })
    const v2Items = (await readDocument(service, v2)).byKey
    // V3 is based on V1 but retires V2: only Pilau is new.
    await publishMenu(
      admin,
      w.venue,
      menu("TEST manager photos v3", [
        section(
          "mains",
          "Mains",
          [
            "mains--korma",
            "mains--tikka",
            "mains--dal",
            "mains--bhaji",
            "mains--naan",
            "mains--biryani",
          ]
            .map((key) =>
              item(key, v2Items[key]!.name, {
                itemId: v2Items[key]!.itemId,
                variants: v2Items[key]!.variants,
              })
            )
            .concat([item("mains--pilau", "Pilau")])
        ),
        section(
          "drinks",
          "Drinks",
          [
            item("drinks--lassi", "Lassi", {
              itemId: v2Items["drinks--lassi"]!.itemId,
            }),
          ],
          "drinks"
        ),
      ]),
      w.version
    )
    expect((await overview(w.mgr, null)).new_items).toBe(1)
  })
})

describe("manager denials still hold", () => {
  it("manager denied coverage writes still; manager cannot relabel its own staff-era photo", async () => {
    const w = await world("mgrph-deny", { tikka: ["mains--tikka"] })
    await fails(
      w.mgr.client.rpc("save_coverage_requirement", {
        p_venue_id: w.venue,
        p_requirement_id: N,
        p_expected_revision: null as unknown as number,
        p_kind: "venue_specific",
        p_title: "TEST denied",
        p_guidance: N,
        p_photo_target: 1,
        p_due_on: N,
      }),
      "not_venue_manager",
      "42501"
    )
    // w.history.tikka is this account's own photo, uploaded and labelled
    // while it was staff. A manager account labels only its manager-era
    // uploads (B02 W4), so the save is refused at the asset and changes
    // nothing.
    const labelState = async () => {
      const label = await service
        .from("media_labels")
        .select("*")
        .eq("asset_id", w.history.tikka!)
        .single()
      const items = await service
        .from("media_label_items")
        .select("*")
        .eq("asset_id", w.history.tikka!)
        .order("id")
      if (label.error) throw label.error
      if (items.error) throw items.error
      return { label: label.data, items: items.data }
    }
    const before = await labelState()
    expect(before.items).toHaveLength(1)
    await fails(
      saveLabels(w.mgr, {
        asset: w.history.tikka!,
        revision: before.label.revision,
        items: [],
        catalogue: w.version,
      }),
      "media_asset_not_found",
      "P0002"
    )
    expect(await labelState()).toEqual(before)
  })
})

describe("revoked or inactive scope", () => {
  it("revoked or inactive scope: reads refuse, writes are not found, previews and replays fail", async () => {
    const w = await world("mgrph-revoke")
    const [m2, m3] = await Promise.all([
      staff("mgrph-revoke-m2", w.venue),
      staff("mgrph-revoke-m3", w.venue),
    ])
    await makeManager(admin, m2, w.venue)
    await makeManager(admin, m3, w.venue)
    const tikka = t(w.items["mains--tikka"]!)
    const dal = t(w.items["mains--dal"]!)
    const asset = (await labelled(w.staff1, w.version, [tikka])).id
    const other = (await labelled(w.staff2, w.version, [dal])).id
    const keys = new Map<TestIdentity, string>()
    for (const who of [w.mgr, m2, m3]) keys.set(who, requestKey())
    const [accepted] = await ok(
      review(w.mgr, asset, tikka, "accepted", 1, { key: keys.get(w.mgr) })
    )
    await ok(
      review(m2, other, dal, "better_photo_requested", 1, {
        reason: "Dark",
        key: keys.get(m2),
      })
    )
    const extra = (
      await labelled(w.staff1, w.version, [t(w.items["mains--bhaji"]!)])
    ).id
    await ok(
      review(m3, extra, t(w.items["mains--bhaji"]!), "accepted", 1, {
        key: keys.get(m3),
      })
    )

    async function expectNoScope(who: TestIdentity) {
      const itemId = tikka.itemId
      for (const [fn, args] of [
        ["manager_menu_photo_overview", {}],
        ["manager_menu_photo_items", {}],
        ["manager_menu_photo_queue", {}],
        ["manager_menu_photo_item", { p_venue_id: w.venue, p_item_id: itemId }],
        [
          "manager_menu_photo_item_events",
          { p_venue_id: w.venue, p_item_id: itemId },
        ],
        ["manager_menu_photo_contributors", { p_venue_id: w.venue }],
        [
          "manager_menu_photo_contributor",
          { p_venue_id: w.venue, p_contributor_id: w.staff1.id },
        ],
      ] as const)
        await fails(
          who.client.rpc(fn, args as never) as never,
          "not_venue_manager",
          "42501"
        )
      await fails(
        review(who, other, dal, "accepted", await head(dal.itemId)),
        "media_asset_not_found",
        "P0002"
      )
      await fails(
        assign(who, other, tikka, dal, await head(tikka.itemId), {
          reason: "x",
        }),
        "media_asset_not_found",
        "P0002"
      )
      await fails(
        withdraw(who, accepted!.photo_id, await head(tikka.itemId), "x"),
        "menu_item_photo_not_found",
        "P0002"
      )
      await fails(
        setPrimary(who, accepted!.photo_id, await head(tikka.itemId)),
        "menu_item_photo_not_found",
        "P0002"
      )
      expect(await previewable(who, other)).toBe(false)
    }

    // Deactivated.
    await setProfile(w.mgr.id, { active: false })
    await expectNoScope(w.mgr)
    await fails(
      review(w.mgr, asset, tikka, "accepted", 1, { key: keys.get(w.mgr) }),
      "media_asset_not_found",
      "P0002"
    )
    // Converted back to staff, with no grant.
    await ok(
      admin.client.rpc("convert_manager_to_staff", {
        p_profile_id: m2.id,
        p_venue_id: w.venue,
        p_reason: "TEST back to staff",
        p_client_request_key: requestKey(),
      })
    )
    await expectNoScope(m2)
    await fails(
      review(m2, other, dal, "better_photo_requested", 1, {
        reason: "Dark",
        key: keys.get(m2),
      }),
      "media_asset_not_found",
      "P0002"
    )
    // The venue is made inactive.
    const { error } = await service
      .from("venues")
      .update({ active: false })
      .eq("id", w.venue)
    if (error) throw error
    await expectNoScope(m3)
    await fails(
      review(m3, extra, t(w.items["mains--bhaji"]!), "accepted", 1, {
        key: keys.get(m3),
      }),
      "media_asset_not_found",
      "P0002"
    )
  })
})

describe("candidates, accepted rows and unlabelled reviewer rows", () => {
  let w: World
  let gA: TestIdentity

  beforeAll(async () => {
    w = await world("mgrph-guards", { naan: ["mains--naan", 0] })
    gA = await staff("mgrph-guards-ga", w.venue)
    await legacyStaffGrant(service, admin, gA.id, w.venue)
  })

  it("candidates report an active manager-account uploader as active", async () => {
    const naan = t(w.items["mains--naan"]!, 0)
    const staffPhoto = await labelled(w.staff1, w.version, [naan])
    const rows = await ok(
      admin.client.rpc("menu_item_photo_candidates", {
        p_venue_id: w.venue,
        p_item_id: naan.itemId,
      })
    )
    const byAsset = (asset: string) => rows.find((r) => r.asset_id === asset)!
    expect(byAsset(w.history.naan!)).toMatchObject({
      uploader_id: w.mgr.id,
      uploader_active: true,
    })
    expect(byAsset(staffPhoto.id)).toMatchObject({
      uploader_id: w.staff1.id,
      uploader_active: true,
    })
  })

  it("assign on an accepted row: staff-label and different corrections refused, the same one is a no-op", async () => {
    const tikka = t(w.items["mains--tikka"]!)
    const dal = t(w.items["mains--dal"]!)
    const korma = t(w.items["mains--korma"]!, 0)

    // An accepted staff-label row is decided through review only.
    const p = await labelled(w.staff1, w.version, [tikka])
    const staffRow = await accept(w.mgr, p.id, tikka)
    const staffEvents = await eventCount(staffRow.photo_id)
    for (const corrects of [dal, null])
      await fails(
        assign(w.mgr, p.id, tikka, corrects, await head(tikka.itemId), {
          reason: "x",
        }),
        "menu_item_labelled",
        "P0001"
      )
    expect(await eventCount(staffRow.photo_id)).toBe(staffEvents)

    // An accepted reviewer row: only its own correction replays.
    const q = await labelled(w.staff2, w.version, [tikka])
    const moved = await assignOk(w.mgr, q.id, dal, tikka, "It is dal")
    const events = await eventCount(moved.photo_id)
    for (const corrects of [null, korma])
      await fails(
        assign(w.mgr, q.id, dal, corrects, await head(dal.itemId), {
          reason: "x",
        }),
        "corrects_mismatch",
        "22023"
      )
    const same = await assignOk(w.mgr, q.id, dal, tikka, "It is dal")
    expect(same).toMatchObject({
      photo_id: moved.photo_id,
      state: "accepted",
      replayed: true,
    })
    expect(await eventCount(moved.photo_id)).toBe(events)
    expect(await photo(moved.photo_id)).toMatchObject({
      corrects_item_id: tikka.itemId,
      reason: "It is dal",
    })
  })

  it("unlabelled reviewer rows: a legacy staff grantee cannot reaccept or withdraw; a manager can", async () => {
    const bhaji = t(w.items["mains--bhaji"]!)
    const u = await unlabelled(w.staff1, ["dish"])
    const row = await assignOk(w.mgr, u, bhaji, null)
    // Accepted: the no-op replay is refused too, and so is withdrawal.
    await fails(
      assign(gA, u, bhaji, null, await head(bhaji.itemId)),
      "not_venue_manager",
      "42501"
    )
    await fails(
      withdraw(gA, row.photo_id, await head(bhaji.itemId), "No"),
      "not_venue_manager",
      "42501"
    )
    // Sent for a recheck (as activation does).
    const before = await photo(row.photo_id)
    const { error } = await service
      .from("menu_item_photos")
      .update({
        state: "needs_recheck",
        recheck_kind: "name_changed",
        is_primary: false,
        revision: before.revision + 1,
      })
      .eq("id", row.photo_id)
    if (error) throw error
    const events = await eventCount(row.photo_id)
    await fails(
      assign(gA, u, bhaji, null, await head(bhaji.itemId)),
      "not_venue_manager",
      "42501"
    )
    await fails(
      withdraw(gA, row.photo_id, await head(bhaji.itemId), "No"),
      "not_venue_manager",
      "42501"
    )
    expect(await eventCount(row.photo_id)).toBe(events)
    expect((await photo(row.photo_id)).state).toBe("needs_recheck")

    const back = await assignOk(w.mgr, u, bhaji, null)
    expect(back).toMatchObject({
      photo_id: row.photo_id,
      state: "accepted",
      replayed: false,
    })
    await ok(withdraw(w.mgr, row.photo_id, await head(bhaji.itemId), "Blurry"))
    expect((await photo(row.photo_id)).state).toBe("withdrawn")
  })
})
