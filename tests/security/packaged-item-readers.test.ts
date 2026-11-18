// S5-R1 (FA-51; review findings Y1, Y2, Y3;
// 20261118136000_packaged_item_readers.sql): the older menu-photo readers
// follow the packaged rule in private.coverage_slot_rows. With an optional
// packaged item present (packaged, no Photo wanted), every count of the
// manager Overview, the manager Menu list and item, and staff Our menu
// (summary and list) is compared with the rule's own rows: an optional item
// is never in a total, never a gap and never has a needed-by date, and Our
// menu is not empty when only optional items remain. Real signed-in
// identities through PostgREST; the service role and psql only build
// fixtures and read the rule back.
import { beforeAll, describe, expect, it } from "vitest"

import type { MenuDocSection } from "../../lib/menus/types"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { fails, makeManager, ok, psql } from "./coverage-fixtures"
import { call } from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveOk,
  section,
} from "./menus-fixtures"

const service = serviceClient()

type Rpc<T = unknown> = PromiseLike<{
  data: T | null
  error: { message: string; code: string; details?: string } | null
}>

type World = {
  venue: string
  version: string
  id: (key: string) => string
  mgr: TestIdentity
  staff: TestIdentity
}

type Overview = {
  menu_state: string
  eligible_items: number
  covered_items: number
  awaiting_review_items: number
  needs_photo_items: number
  replacement_pending_items: number
  needs_recheck_items: number
  pending_photos: number
  new_items: number
  sections: Array<{
    kind: string
    eligible: number
    covered: number
    awaitingReview: number
    needsPhoto: number
  }>
}
type ManagerItem = {
  item_id: string
  status: string
  needed_by: string | null
}
type StaffItem = {
  item_id: string
  covered: boolean
  needed_by: string | null
  optional: boolean
}
type Summary = {
  menu_state: string
  section_kind: string | null
  eligible_items: number
  covered_items: number
  pending_candidates: number | null
}

let admin: TestIdentity
let aal1Admin: TestIdentity
let w: World
let other: World
let bottlesOnly: World

async function world(
  label: string,
  sections: MenuDocSection[]
): Promise<World> {
  const venue = (await createVenue(service, label)).id
  const version = await publishMenu(
    admin,
    venue,
    menu(`TEST ${label}`, sections)
  )
  const { byKey } = await readDocument(service, version)
  const [mgr, staff] = await Promise.all(
    ["mgr", "s"].map((s) =>
      createIdentity(service, {
        label: `${label}-${s}`,
        role: "staff",
        venueId: venue,
      })
    )
  )
  await makeManager(admin, mgr!, venue)
  return {
    venue,
    version,
    id: (key) => byKey[key]!.itemId,
    mgr: mgr!,
    staff: staff!,
  }
}

const MIXED = () => [
  section("mains", "Mains", [item("mains--korma", "Korma")]),
  section(
    "drinks",
    "Drinks",
    [item("drinks--lager", "Bottled lager"), item("drinks--lassi", "Lassi")],
    "drinks"
  ),
]

const setPackaging = (
  who: TestIdentity,
  itemId: string,
  packaged: boolean,
  photoWanted = false
) =>
  call(who, "menu_item_packaging_set", {
    p_item_id: itemId,
    p_packaged: packaged,
    p_photo_wanted: photoWanted,
  })

/** The rule's own dish rows, read back as the owner (fixture read only). */
function ruleDishes(venue: string) {
  const out = psql(
    `select coalesce(json_agg(json_build_object('id', c.slot_id, 'state', c.state, 'kind', c.category)), '[]')
     from private.coverage_slot_rows('${venue}'::uuid) c where c.slot_kind = 'dish'`
  )
  return JSON.parse(out) as Array<{ id: string; state: string; kind: string }>
}

const overview = async (who: TestIdentity, venue: string) =>
  (await ok(
    call(who, "manager_menu_photo_overview", { p_venue_id: venue }) as Rpc<
      Overview[]
    >
  ))![0]!

const managerItems = async (
  who: TestIdentity,
  venue: string,
  status?: string
) =>
  (await ok(
    call(who, "manager_menu_photo_items", {
      p_venue_id: venue,
      ...(status ? { p_status: status } : {}),
    }) as Rpc<ManagerItem[]>
  ))!

const staffItems = async (who: TestIdentity, gapsOnly = false) =>
  (await ok(
    call(who, "menu_item_photo_items", { p_gaps_only: gapsOnly }) as Rpc<
      StaffItem[]
    >
  ))!

const summary = async (who: TestIdentity) =>
  (await ok(call(who, "menu_item_photo_summary", {}) as Rpc<Summary[]>))!

const ids = (rows: Array<{ item_id: string }>) =>
  rows.map((r) => r.item_id).sort()
const ruleIds = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort()

/**
 * Every count and gap list against the rule. The fixtures never age a
 * photo or raise a recheck, so 'covered' is the only covered state.
 */
async function expectAgreesWithRule(x: World) {
  const rule = ruleDishes(x.venue)
  const counted = rule.filter((r) => r.state !== "inactive")
  const optional = rule.filter((r) => r.state === "inactive")
  const covered = rule.filter((r) => r.state === "covered")
  const pending = rule.filter((r) => r.state === "pending")
  const missing = rule.filter(
    (r) => r.state === "missing" || r.state === "replacement_needed"
  )

  // Y1: the manager Overview heading, its tallies and every section.
  const o = await overview(x.mgr, x.venue)
  expect(o.menu_state).toBe("ready")
  expect(o.eligible_items).toBe(counted.length)
  expect(o.covered_items).toBe(covered.length)
  expect(o.awaiting_review_items).toBe(pending.length)
  expect(o.needs_photo_items).toBe(missing.length)
  for (const kind of ["food", "drinks"]) {
    const sec = o.sections.find((s) => s.kind === kind)
    if (!sec) continue
    expect(sec.eligible).toBe(counted.filter((r) => r.kind === kind).length)
    expect(sec.covered).toBe(covered.filter((r) => r.kind === kind).length)
    expect(sec.needsPhoto).toBe(missing.filter((r) => r.kind === kind).length)
  }

  // Y2: the manager Menu filters list exactly the counted items.
  expect(ids(await managerItems(x.mgr, x.venue, "needs_photo"))).toEqual(
    ruleIds(missing)
  )
  expect(ids(await managerItems(x.mgr, x.venue, "covered"))).toEqual(
    ruleIds(covered)
  )
  expect(ids(await managerItems(x.mgr, x.venue, "awaiting_review"))).toEqual(
    ruleIds(pending)
  )
  // The full list still lists every item, optional ones included.
  const all = await managerItems(x.mgr, x.venue)
  expect(ids(all)).toEqual(ruleIds(rule))
  for (const r of all.filter((i) => optional.some((o) => o.id === i.item_id))) {
    expect(r.status).not.toBe("needs_photo")
    expect(r.needed_by).toBeNull()
  }

  // Y2: staff Our menu's "Still needs a photo" is the rule's gaps.
  expect(ids(await staffItems(x.staff, true))).toEqual(
    ruleIds([...missing, ...pending])
  )
  const staffAll = await staffItems(x.staff)
  expect(ids(staffAll)).toEqual(ruleIds(rule))
  for (const r of staffAll) {
    const isOptional = optional.some((o) => o.id === r.item_id)
    expect(r.optional).toBe(isOptional)
    if (isOptional) expect(r.needed_by).toBeNull()
  }

  // Y3: Our menu's summary totals are the rule's.
  const s = await summary(x.staff)
  expect(s.every((r) => r.menu_state === "ready")).toBe(true)
  expect(s.reduce((n, r) => n + r.eligible_items, 0)).toBe(counted.length)
  expect(s.reduce((n, r) => n + r.covered_items, 0)).toBe(covered.length)
  return { o, all, staffAll }
}

async function head(itemId: string) {
  const { data } = await service
    .from("menu_item_photo_heads")
    .select("revision")
    .eq("item_id", itemId)
    .maybeSingle()
  return data?.revision ?? 1
}

async function sendPhoto(x: World, itemId: string) {
  const asset = await reserveReady(service, x.staff)
  await saveOk(x.staff, {
    asset: asset.id,
    revision: 0,
    types: ["dish"],
    items: [{ itemId, variantId: null }],
    catalogue: x.version,
  })
  return asset.id
}

async function accept(x: World, assetId: string, itemId: string) {
  await ok(
    x.mgr.client.rpc("review_menu_item_photo", {
      p_asset_id: assetId,
      p_item_id: itemId,
      p_variant_id: null as unknown as string,
      p_decision: "accepted",
      p_expected_revision: await head(itemId),
      p_make_primary: true,
    })
  )
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "pkg-readers-admin",
    role: "admin",
  })
  ;[w, other, bottlesOnly] = await Promise.all([
    world("pkg-readers-a", MIXED()),
    world("pkg-readers-b", MIXED()),
    world("pkg-readers-c", [
      section(
        "bottles",
        "Bottles",
        [item("bottles--cola", "Bottled cola"), item("bottles--ale", "Ale")],
        "drinks"
      ),
    ]),
  ])
  aal1Admin = await createIdentity(service, {
    label: "pkg-readers-admin-aal1",
    role: "staff",
    venueId: w.venue,
  })
  await ok(
    service
      .from("profiles")
      .update({ role: "admin", venue_id: null })
      .eq("id", aal1Admin.id)
  )
})

describe("who may read the counts", () => {
  it("refuses staff, a manager of another venue and an admin without MFA on the manager reads", async () => {
    for (const fn of [
      "manager_menu_photo_overview",
      "manager_menu_photo_items",
    ]) {
      await fails(
        call(w.staff, fn, { p_venue_id: w.venue }),
        "not_venue_manager",
        "42501"
      )
      await fails(
        call(other.mgr, fn, { p_venue_id: w.venue }),
        "not_venue_manager",
        "42501"
      )
      const { error } = await call(aal1Admin, fn, { p_venue_id: w.venue })
      expect(error).not.toBeNull()
    }
  })

  it("never serves another venue's Our menu list to staff", async () => {
    const { data, error } = await call(other.staff, "menu_item_photo_items", {
      p_venue_id: w.venue,
    })
    expect(error ?? (data as unknown[]).length === 0).toBeTruthy()
  })

  it("keeps the rule helper out of reach", async () => {
    const { error } = await call(w.mgr, "menu_optional_item_ids", {
      p_venue_id: w.venue,
    })
    expect(error).not.toBeNull()
  })
})

describe("every count agrees with coverage_slot_rows (FA-51)", () => {
  it("with no packaged item, nothing changes", async () => {
    const { o, staffAll } = await expectAgreesWithRule(w)
    expect(o.eligible_items).toBe(3)
    expect(staffAll.every((r) => !r.optional)).toBe(true)
  })

  it("an optional packaged item leaves the Overview, both gap lists and its needed-by date", async () => {
    const lager = w.id("drinks--lager")
    await ok(
      call(w.mgr, "set_menu_item_needed_by", {
        p_item_id: lager,
        p_needed_by: inDays(3),
      })
    )
    let staffAll = await staffItems(w.staff)
    expect(staffAll.find((r) => r.item_id === lager)!.needed_by).toBe(inDays(3))

    await ok(setPackaging(w.mgr, lager, true))
    const { o, all } = await expectAgreesWithRule(w)
    expect(o.eligible_items).toBe(2)
    expect(o.needs_photo_items).toBe(2)
    expect(o.sections.find((s) => s.kind === "drinks")).toMatchObject({
      eligible: 1,
      needsPhoto: 1,
    })
    expect(all.find((r) => r.item_id === lager)).toMatchObject({
      status: "optional",
      needed_by: null,
    })
    staffAll = await staffItems(w.staff)
    expect(staffAll.find((r) => r.item_id === lager)).toMatchObject({
      optional: true,
      covered: false,
      needed_by: null,
    })
    expect(
      (await staffItems(w.staff, true)).some((r) => r.item_id === lager)
    ).toBe(false)
    const item = (await ok(
      call(w.mgr, "manager_menu_photo_item", {
        p_venue_id: w.venue,
        p_item_id: lager,
      }) as Rpc<Array<{ status: string }>>
    ))!
    expect(item[0]!.status).toBe("optional")
  })

  it("its waiting photo still waits for review, but is never counted as awaiting", async () => {
    const lager = w.id("drinks--lager")
    const before = (await overview(w.mgr, w.venue)).pending_photos
    const asset = await sendPhoto(w, lager)
    const { o, all } = await expectAgreesWithRule(w)
    expect(o.pending_photos).toBe(before + 1)
    expect(o.awaiting_review_items).toBe(0)
    expect(all.find((r) => r.item_id === lager)!.status).toBe("awaiting_review")
    // Our menu's reviewer figures still count the waiting photo.
    const drinks = (await summary(w.mgr)).find(
      (r) => r.section_kind === "drinks"
    )!
    expect(drinks.pending_candidates).toBe(1)

    // Accepted: its photo is kept, the numerator is unchanged.
    await accept(w, asset, lager)
    const after = await expectAgreesWithRule(w)
    expect(after.o.covered_items).toBe(0)
    expect(after.all.find((r) => r.item_id === lager)!.status).toBe("covered")
  })

  it("a counted item accepted next to it is counted as covered everywhere", async () => {
    const korma = w.id("mains--korma")
    await accept(w, await sendPhoto(w, korma), korma)
    const { o } = await expectAgreesWithRule(w)
    expect(o).toMatchObject({ eligible_items: 2, covered_items: 1 })
  })

  it("Photo wanted brings it back into every count", async () => {
    const lager = w.id("drinks--lager")
    await ok(setPackaging(w.mgr, lager, true, true))
    const { o, staffAll } = await expectAgreesWithRule(w)
    expect(o).toMatchObject({ eligible_items: 3, covered_items: 2 })
    expect(staffAll.find((r) => r.item_id === lager)!.optional).toBe(false)
  })

  it("another venue's counts are untouched", async () => {
    const { o } = await expectAgreesWithRule(other)
    expect(o.eligible_items).toBe(3)
  })
})

describe("a menu of only optional items is never empty (Y3)", () => {
  it("keeps Our menu and the Overview ready, with the items listed and no gaps", async () => {
    const x = bottlesOnly
    for (const key of ["bottles--cola", "bottles--ale"])
      await ok(setPackaging(x.mgr, x.id(key), true))
    await expectAgreesWithRule(x)

    const s = await summary(x.staff)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({
      menu_state: "ready",
      section_kind: "drinks",
      eligible_items: 0,
      covered_items: 0,
    })
    const o = await overview(x.mgr, x.venue)
    expect(o).toMatchObject({
      menu_state: "ready",
      eligible_items: 0,
      needs_photo_items: 0,
    })
    expect(o.sections).toHaveLength(1)
    const listed = await staffItems(x.staff)
    expect(listed).toHaveLength(2)
    expect(listed.every((r) => r.optional)).toBe(true)
    expect(await staffItems(x.staff, true)).toEqual([])
  })
})
