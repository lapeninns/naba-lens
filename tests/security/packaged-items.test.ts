// FA-51 packaged drinks (20261118133000_packaged_items.sql; spec §4.2; AC39):
// a manager of the venue or an admin marks a menu item Packaged and
// optionally Photo wanted. A packaged item without Photo wanted is optional:
// still listed, takes photos and can be accepted, but it leaves the total and
// is never empty in any count. Who may set and read the designation, that
// every count reads the one rule, and that AC39 (n of N from the counted
// slots) still holds. Real signed-in identities through PostgREST; the
// service role and psql only build fixtures and read back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { fails, makeManager, ok } from "./coverage-fixtures"
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

const MENU = () =>
  menu("TEST packaged", [
    section("mains", "Mains", [item("mains--korma", "Korma")]),
    section(
      "drinks",
      "Drinks",
      [item("drinks--lager", "Bottled lager"), item("drinks--lassi", "Lassi")],
      "drinks"
    ),
  ])

type World = {
  venue: string
  version: string
  id: (key: string) => string
  mgr: TestIdentity
  staff: TestIdentity
}

let admin: TestIdentity
let aal1Admin: TestIdentity
let w: World
let other: World

async function world(label: string): Promise<World> {
  const venue = (await createVenue(service, label)).id
  const version = await publishMenu(admin, venue, MENU())
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

const setPackaging = (
  who: TestIdentity | { client: unknown },
  itemId: string,
  packaged: boolean,
  photoWanted = false
) =>
  call(who, "menu_item_packaging_set", {
    p_item_id: itemId,
    p_packaged: packaged,
    p_photo_wanted: photoWanted,
  }) as Rpc<{ changed: boolean; packaged: boolean; photoWanted: boolean }>

type Slot = {
  kind: string
  slotId: string
  state: string
  required: boolean
  counted: boolean
  category: string
  primaryAssetId: string | null
  pendingCount: number
}
type Counts = { total: number; covered: number; missing: number }
type Coverage = {
  slots: Slot[]
  categories: Array<{ category: string } & Counts>
  totals: Counts
}

async function coverage(who: TestIdentity, venue?: string) {
  return (await ok(
    call(
      who,
      "coverage_slots",
      venue ? { p_venue_id: venue } : {}
    ) as Rpc<Coverage>
  ))!
}

const slotOf = (c: Coverage, itemId: string) =>
  c.slots.find((s) => s.kind === "dish" && s.slotId === itemId)!
const drinks = (c: Coverage) => c.categories.find((x) => x.category === "drinks")!

/** AC39: the counts reproduce from the counted slots. */
function expectReproduces(c: Coverage) {
  const counted = c.slots.filter(
    (s) => s.state !== "not_here" && s.state !== "inactive"
  )
  expect(c.totals.total).toBe(counted.length)
  expect(c.totals.covered).toBe(
    c.slots.filter((s) => s.state === "covered").length
  )
  expect(c.totals.missing).toBe(
    c.slots.filter((s) => s.state === "missing").length
  )
  for (const s of c.slots) expect(s.counted).toBe(counted.includes(s))
}

async function head(itemId: string) {
  const { data } = await service
    .from("menu_item_photo_heads")
    .select("revision")
    .eq("item_id", itemId)
    .maybeSingle()
  return data?.revision ?? 1
}

async function sendPhoto(itemId: string) {
  const asset = await reserveReady(service, w.staff)
  await saveOk(w.staff, {
    asset: asset.id,
    revision: 0,
    types: ["dish"],
    items: [{ itemId, variantId: null }],
    catalogue: w.version,
  })
  return asset.id
}

async function accept(assetId: string, itemId: string) {
  await ok(
    w.mgr.client.rpc("review_menu_item_photo", {
      p_asset_id: assetId,
      p_item_id: itemId,
      p_variant_id: null as unknown as string,
      p_decision: "accepted",
      p_expected_revision: await head(itemId),
      p_make_primary: true,
    })
  )
}

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "packaged-admin",
    role: "admin",
  })
  ;[w, other] = await Promise.all([
    world("packaged-a"),
    world("packaged-b"),
  ])
  // Signed in as staff (aal1), then made an admin: no second factor.
  aal1Admin = await createIdentity(service, {
    label: "packaged-admin-aal1",
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

describe("who may set and read the designation", () => {
  it("refuses staff, a manager of another venue, an admin without MFA and anon", async () => {
    const lager = w.id("drinks--lager")
    await fails(setPackaging(w.staff, lager, true), "not_venue_manager", "42501")
    await fails(setPackaging(other.mgr, lager, true), "not_venue_manager", "42501")
    const { error } = await setPackaging(aal1Admin, lager, true)
    expect(error).not.toBeNull()
    const anon = await anonClient().rpc("menu_item_packaging_set" as never, {
      p_item_id: lager,
      p_packaged: true,
    } as never)
    expect(anon.error).not.toBeNull()

    await fails(call(w.staff, "menu_item_packaging", {}), "not_venue_manager", "42501")
    // Never a read of another venue's designations.
    const across = await call(other.mgr, "menu_item_packaging", {
      p_venue_id: w.venue,
    })
    expect(across.error).not.toBeNull()
    const aal1Read = await call(aal1Admin, "menu_item_packaging", {
      p_venue_id: w.venue,
    })
    expect(aal1Read.error).not.toBeNull()

    // Nothing was written by the refused calls.
    const { data } = await service
      .from("menu_item_packaging")
      .select("item_id")
      .eq("item_id", lager)
    expect(data).toEqual([])
  })

  it("keeps the table behind its functions", async () => {
    const { data, error } = await (
      w.mgr.client as unknown as {
        from: (t: string) => {
          select: (c: string) => PromiseLike<{
            data: unknown[] | null
            error: unknown
          }>
        }
      }
    )
      .from("menu_item_packaging")
      .select("item_id")
    expect(error ?? (data ?? []).length === 0).toBeTruthy()
  })

  it("refuses Photo wanted without Packaged", async () => {
    await fails(
      setPackaging(w.mgr, w.id("drinks--lassi"), false, true),
      "invalid_packaging",
      "22023"
    )
  })
})

describe("the rule (FA-51, AC39)", () => {
  it("defaults keep today's behaviour: every drink is counted", async () => {
    const c = await coverage(w.staff)
    expect(drinks(c)).toMatchObject({ total: 2, covered: 0, missing: 2 })
    expect(slotOf(c, w.id("drinks--lager"))).toMatchObject({
      state: "missing",
      required: true,
      counted: true,
    })
    expectReproduces(c)
    const listed = (await ok(
      call(w.mgr, "menu_item_packaging", {}) as Rpc<{
        items: Array<{
          itemId: string
          packaged: boolean
          photoWanted: boolean
          kind: string
        }>
      }>
    ))!.items
    expect(listed).toHaveLength(3)
    expect(listed.every((i) => !i.packaged && !i.photoWanted)).toBe(true)
  })

  it("a packaged item without Photo wanted leaves the total, still takes and accepts photos, and never counts as empty", async () => {
    const lager = w.id("drinks--lager")
    expect(await ok(setPackaging(w.mgr, lager, true))).toMatchObject({
      changed: true,
      packaged: true,
      photoWanted: false,
    })
    expect(await ok(setPackaging(w.mgr, lager, true))).toMatchObject({
      changed: false,
    })
    let c = await coverage(w.staff)
    expect(slotOf(c, lager)).toMatchObject({
      state: "inactive",
      required: false,
      counted: false,
      category: "drinks",
    })
    expect(drinks(c)).toMatchObject({ total: 1, covered: 0, missing: 1 })
    expectReproduces(c)

    // A photo is sent: waiting, still not in any count.
    const asset = await sendPhoto(lager)
    c = await coverage(w.staff)
    expect(slotOf(c, lager)).toMatchObject({
      state: "inactive",
      pendingCount: 1,
    })
    expect(drinks(c)).toMatchObject({ total: 1 })

    // Accepted: its photo shows, the numerator is unchanged.
    await accept(asset, lager)
    c = await coverage(w.mgr)
    expect(slotOf(c, lager)).toMatchObject({
      state: "inactive",
      primaryAssetId: asset,
    })
    expect(drinks(c)).toMatchObject({ total: 1, covered: 0 })
    expectReproduces(c)

    // Our menu and the admin album leave it out of their section totals.
    const summary = (await ok(
      w.mgr.client.rpc("menu_item_photo_summary", { p_venue_id: w.venue })
    ))!
    const drinkRow = summary.find((r) => r.section_kind === "drinks")!
    expect(drinkRow).toMatchObject({ eligible_items: 1, covered_items: 0 })
    const albumCounts = (await ok(
      admin.client.rpc("album_admin_counts", { p_venue_id: w.venue })
    )) as unknown as {
      sections: Array<{ kind: string; total: number; accepted: number }>
      totals: Counts
    }
    expect(
      albumCounts.sections.find((s) => s.kind === "drinks")
    ).toMatchObject({ total: 1, accepted: 0 })
    expect(albumCounts.totals).toEqual(c.totals)

  })

  it("Photo wanted brings it back into the total", async () => {
    const lager = w.id("drinks--lager")
    await ok(setPackaging(w.mgr, lager, true, true))
    const c = await coverage(w.staff)
    // The accepted photo now covers it.
    expect(slotOf(c, lager)).toMatchObject({
      state: "covered",
      required: true,
      counted: true,
    })
    expect(drinks(c)).toMatchObject({ total: 2, covered: 1 })
    expectReproduces(c)
  })

  it("an admin sets it too, and clearing Packaged restores the default", async () => {
    const lassi = w.id("drinks--lassi")
    expect(await ok(setPackaging(admin, lassi, true))).toMatchObject({
      changed: true,
    })
    let c = await coverage(admin, w.venue)
    expect(slotOf(c, lassi)).toMatchObject({ state: "inactive" })
    const read = (await ok(
      call(admin, "menu_item_packaging", { p_venue_id: w.venue }) as Rpc<{
        items: Array<{ itemId: string; packaged: boolean }>
      }>
    ))!.items
    expect(read.find((i) => i.itemId === lassi)).toMatchObject({
      packaged: true,
    })

    await ok(setPackaging(w.mgr, lassi, false))
    c = await coverage(w.staff)
    expect(slotOf(c, lassi)).toMatchObject({
      state: "missing",
      required: true,
    })
    const { data } = await service
      .from("menu_item_packaging")
      .select("item_id")
      .eq("item_id", lassi)
    expect(data).toEqual([])
    expectReproduces(c)
  })

  it("records each change in the menu history, without a reason", async () => {
    const { data } = await service
      .from("menu_events")
      .select("action, actor_id, detail, item_id")
      .eq("venue_id", w.venue)
      .eq("action", "packaging_set")
      .order("id")
    expect(data!.length).toBe(4)
    expect(data![0]).toMatchObject({
      actor_id: w.mgr.id,
      item_id: w.id("drinks--lager"),
      detail: {
        packaged: true,
        photoWanted: false,
        previous: { packaged: false, photoWanted: false },
      },
    })
  })

  it("another venue's counts are untouched", async () => {
    const c = await coverage(other.staff)
    expect(drinks(c)).toMatchObject({ total: 2 })
    expectReproduces(c)
  })
})
