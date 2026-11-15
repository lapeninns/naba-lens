// G-7 "needed by" on one dish (20261116150000): who may set and clear the
// date, which dishes it may go on, how it orders Still needed for everyone at
// the venue, that it clears when a photo is accepted, and that it has no
// overdue state. Real signed-in identities through PostgREST; the service
// role only builds fixtures and reads state back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { fails, legacyStaffGrant, makeManager, ok } from "./coverage-fixtures"
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

const MENU = () =>
  menu("TEST needed by", [
    section("mains", "Mains", [
      item("mains--korma", "Korma"),
      item("mains--tikka", "Tikka"),
      item("mains--dal", "Dal"),
      item("mains--bhaji", "Bhaji"),
    ]),
    section("drinks", "Drinks", [item("drinks--lassi", "Lassi")], "drinks"),
  ])

type World = {
  venue: string
  version: string
  items: Record<string, CatalogueRow>
  staff1: TestIdentity
  mgr: TestIdentity
  grantee: TestIdentity
}

const staff = (label: string, venueId: string) =>
  createIdentity(service, { label, role: "staff", venueId })

async function world(label: string): Promise<World> {
  const venue = (await createVenue(service, label)).id
  const version = await publishMenu(admin, venue, MENU())
  const items = (await readDocument(service, version)).byKey
  const [staff1, mgr, grantee] = await Promise.all([
    staff(`${label}-s1`, venue),
    staff(`${label}-mgr`, venue),
    staff(`${label}-grant`, venue),
  ])
  await makeManager(admin, mgr, venue)
  await legacyStaffGrant(service, admin, grantee.id, venue)
  return { venue, version, items, staff1, mgr, grantee }
}

/** "YYYY-MM-DD" in Europe/London, `days` from today. */
function londonDay(days = 0): string {
  const now = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

const id = (w: World, key: string) => w.items[key]!.itemId

function setNeeded(
  who: TestIdentity,
  itemId: string,
  date: string,
  venue?: string
) {
  return who.client.rpc(
    "set_menu_item_needed_by" as never,
    {
      p_item_id: itemId,
      p_needed_by: date,
      ...(venue ? { p_venue_id: venue } : {}),
    } as never
  ) as unknown as PromiseLike<{
    data: { item_id: string; needed_by: string }[] | null
    error: { message: string; code: string; details?: string } | null
  }>
}

function clearNeeded(who: TestIdentity, itemId: string, venue?: string) {
  return who.client.rpc(
    "clear_menu_item_needed_by" as never,
    {
      p_item_id: itemId,
      ...(venue ? { p_venue_id: venue } : {}),
    } as never
  ) as unknown as PromiseLike<{
    data: { item_id: string; cleared: boolean }[] | null
    error: { message: string; code: string; details?: string } | null
  }>
}

type ListRow = {
  item_id: string
  name: string
  needed_by: string | null
  needed_by_passed: boolean
  section_position: number
  entry_position: number
}

async function staffList(
  who: TestIdentity,
  args: Record<string, unknown> = {}
): Promise<ListRow[]> {
  return ok(
    who.client.rpc("menu_item_photo_items", {
      p_limit: 101,
      ...args,
    } as never) as unknown as PromiseLike<{
      data: ListRow[] | null
      error: { message: string; code: string; details?: string } | null
    }>
  ) as Promise<ListRow[]>
}

async function managerList(
  who: TestIdentity,
  args: Record<string, unknown> = {}
): Promise<ListRow[]> {
  return ok(
    who.client.rpc("manager_menu_photo_items", {
      p_limit: 101,
      ...args,
    } as never) as unknown as PromiseLike<{
      data: ListRow[] | null
      error: { message: string; code: string; details?: string } | null
    }>
  ) as Promise<ListRow[]>
}

async function rows(venue: string) {
  const { data, error } = await service
    .from("menu_item_needed_by" as never)
    .select("*")
    .eq("venue_id", venue)
  if (error) throw error
  return (data ?? []) as unknown as {
    item_id: string
    needed_by: string
    cleared_at: string | null
    cleared_by_role: string | null
    set_by_role: string
  }[]
}

async function events(venue: string) {
  const { data, error } = await service
    .from("menu_item_needed_by_events" as never)
    .select("action, needed_by, actor_role")
    .eq("venue_id", venue)
    .order("id")
  if (error) throw error
  return (data ?? []) as unknown as {
    action: string
    needed_by: string | null
    actor_role: string
  }[]
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

/** A ready photo of the dish by `who`, labelled, then accepted by `reviewer`. */
async function acceptedPhoto(
  w: World,
  who: TestIdentity,
  reviewer: TestIdentity,
  itemId: string
) {
  const asset = await reserveReady(service, who)
  await saveOk(who, {
    asset: asset.id,
    revision: 0,
    types: ["dish"],
    items: [{ itemId, variantId: null }],
    catalogue: w.version,
  })
  const [row] = await ok(
    reviewer.client.rpc("review_menu_item_photo", {
      p_asset_id: asset.id,
      p_item_id: itemId,
      p_variant_id: null as unknown as string,
      p_decision: "accepted",
      p_expected_revision: await head(itemId),
      p_make_primary: false,
    })
  )
  return row!
}

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "needby-admin",
    role: "admin",
  })
})

describe("setting and clearing needed by", () => {
  let w: World
  let other: World

  beforeAll(async () => {
    ;[w, other] = await Promise.all([
      world("needby-perm"),
      world("needby-other"),
    ])
  })

  it("lets a manager account set and clear a date on its own venue's dish", async () => {
    const dal = id(w, "mains--dal")
    const [set] = await ok(setNeeded(w.mgr, dal, londonDay(3)))
    expect(set).toMatchObject({ item_id: dal, needed_by: londonDay(3) })
    // Setting again moves the date: one row, two history entries.
    await ok(setNeeded(w.mgr, dal, londonDay(5)))
    expect(await rows(w.venue)).toEqual([
      expect.objectContaining({
        item_id: dal,
        needed_by: londonDay(5),
        cleared_at: null,
        set_by_role: "manager",
      }),
    ])
    const [cleared] = await ok(clearNeeded(w.mgr, dal))
    expect(cleared).toMatchObject({ item_id: dal, cleared: true })
    // Clearing again changes nothing.
    const [again] = await ok(clearNeeded(w.mgr, dal))
    expect(again).toMatchObject({ cleared: false })
    const [row] = await rows(w.venue)
    expect(row!.cleared_at).not.toBeNull()
    expect(row!.cleared_by_role).toBe("manager")
    expect((await events(w.venue)).map((e) => e.action)).toEqual([
      "set",
      "set",
      "cleared",
    ])
  })

  it("lets a legacy manager grant holder and an admin set dates", async () => {
    await ok(setNeeded(w.grantee, id(w, "mains--bhaji"), londonDay(2)))
    await ok(setNeeded(admin, id(w, "drinks--lassi"), londonDay(1), w.venue))
    const live = (await rows(w.venue)).filter((r) => r.cleared_at === null)
    expect(live.map((r) => r.set_by_role).sort()).toEqual(["admin", "manager"])
    await ok(clearNeeded(admin, id(w, "drinks--lassi"), w.venue))
    await ok(clearNeeded(w.grantee, id(w, "mains--bhaji")))
  })

  it("refuses staff, another venue's manager and inactive managers, writing nothing", async () => {
    const tikka = id(w, "mains--tikka")
    const before = (await events(w.venue)).length
    await fails(
      setNeeded(w.staff1, tikka, londonDay(1)),
      "not_venue_manager",
      "42501"
    )
    await fails(clearNeeded(w.staff1, tikka), "not_venue_manager", "42501")
    await fails(
      setNeeded(w.staff1, tikka, londonDay(1), w.venue),
      "not_venue_manager",
      "42501"
    )
    // Another venue's manager: naming this venue is refused; its own venue
    // does not have this dish.
    await fails(
      setNeeded(other.mgr, tikka, londonDay(1), w.venue),
      "not_venue_manager",
      "42501"
    )
    await fails(
      setNeeded(other.mgr, tikka, londonDay(1)),
      "menu_item_not_found",
      "P0002"
    )
    await fails(clearNeeded(other.mgr, tikka), "menu_item_not_found", "P0002")
    // An admin names a venue; the dish must belong to it.
    await fails(
      setNeeded(admin, tikka, londonDay(1), other.venue),
      "menu_item_not_found",
      "P0002"
    )
    const leaver = await staff("needby-perm-leaver", w.venue)
    await makeManager(admin, leaver, w.venue)
    const { error } = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", leaver.id)
    if (error) throw error
    await fails(
      setNeeded(leaver, tikka, londonDay(1)),
      "not_venue_manager",
      "42501"
    )
    expect((await events(w.venue)).length).toBe(before)
    expect(
      (await rows(w.venue)).find((r) => r.item_id === tikka)
    ).toBeUndefined()
  })

  it("gives signed-in users no direct write and hides rows from staff", async () => {
    const korma = id(w, "mains--korma")
    await ok(setNeeded(w.mgr, korma, londonDay(4)))
    const insert = await w.mgr.client
      .from("menu_item_needed_by" as never)
      .insert({
        item_id: id(w, "mains--tikka"),
        venue_id: w.venue,
        needed_by: londonDay(1),
        set_by: w.mgr.id,
        set_by_role: "manager",
      } as never)
    expect(insert.error?.code).toBe("42501")
    const update = await w.mgr.client
      .from("menu_item_needed_by" as never)
      .update({ needed_by: londonDay(9) } as never)
      .eq("item_id", korma)
    expect(update.error?.code).toBe("42501")
    const del = await w.mgr.client
      .from("menu_item_needed_by" as never)
      .delete()
      .eq("item_id", korma)
    expect(del.error?.code).toBe("42501")
    const eventInsert = await admin.client
      .from("menu_item_needed_by_events" as never)
      .insert({
        item_id: korma,
        venue_id: w.venue,
        action: "cleared",
        actor_id: admin.id,
        actor_role: "admin",
      } as never)
    expect(eventInsert.error?.code).toBe("42501")
    // Staff read dates only through the item list; the tables show them nothing.
    const staffRead = await w.staff1.client
      .from("menu_item_needed_by" as never)
      .select("*")
    expect(staffRead.data ?? []).toEqual([])
    const otherRead = await other.mgr.client
      .from("menu_item_needed_by" as never)
      .select("*")
    expect(otherRead.data ?? []).toEqual([])
    const own = await w.mgr.client
      .from("menu_item_needed_by" as never)
      .select("item_id")
    expect((own.data ?? []).length).toBeGreaterThan(0)
    await ok(clearNeeded(w.mgr, korma))
  })

  it("refuses dates before today or more than a year ahead", async () => {
    const tikka = id(w, "mains--tikka")
    await fails(
      setNeeded(w.mgr, tikka, londonDay(-1)),
      "invalid_needed_by",
      "22023"
    )
    await fails(
      setNeeded(w.mgr, tikka, londonDay(400)),
      "invalid_needed_by",
      "22023"
    )
    // Today is allowed.
    await ok(setNeeded(w.mgr, tikka, londonDay(0)))
    await ok(clearNeeded(w.mgr, tikka))
  })

  it("refuses a dish that already has an accepted photo or is off the active menu", async () => {
    const lassi = id(other, "drinks--lassi")
    await acceptedPhoto(other, other.staff1, other.mgr, lassi)
    await fails(
      setNeeded(other.mgr, lassi, londonDay(2)),
      "menu_item_has_photo",
      "55000"
    )
    // A menu without Bhaji: the dish keeps its id but is not on the menu.
    const next = await publishMenu(
      admin,
      other.venue,
      menu("TEST needed by 2", [
        section("mains", "Mains", [
          item("mains--korma", "Korma", {
            itemId: id(other, "mains--korma"),
          }),
        ]),
      ]),
      other.version
    )
    expect(next).toBeTruthy()
    await fails(
      setNeeded(other.mgr, id(other, "mains--bhaji"), londonDay(2)),
      "menu_item_unavailable",
      "55000"
    )
  })
})

describe("ordering Still needed", () => {
  let w: World

  beforeAll(async () => {
    w = await world("needby-order")
  })

  it("puts dishes with a date first, earliest first, for staff and managers", async () => {
    const lassi = id(w, "drinks--lassi")
    const dal = id(w, "mains--dal")
    await ok(setNeeded(w.mgr, lassi, londonDay(6)))
    await ok(setNeeded(w.mgr, dal, londonDay(2)))
    const menuOrder = ["Korma", "Tikka", "Bhaji"]
    for (const list of [
      await staffList(w.staff1, { p_gaps_only: true }),
      await staffList(w.staff1),
      await staffList(w.mgr),
      await managerList(w.mgr),
      await managerList(w.grantee),
      await managerList(admin, { p_venue_id: w.venue }),
      await staffList(admin, { p_venue_id: w.venue }),
    ]) {
      expect(list.map((r) => r.name)).toEqual(["Dal", "Lassi", ...menuOrder])
      expect(list.map((r) => r.needed_by)).toEqual([
        londonDay(2),
        londonDay(6),
        null,
        null,
        null,
      ])
      expect(list.every((r) => r.needed_by_passed === false)).toBe(true)
    }
    // Within a section filter the dish still leads.
    const mains = await managerList(w.mgr, { p_status: "needs_photo" })
    expect(mains[0]!.name).toBe("Dal")
  })

  it("pages through the wider cursor without skipping or repeating a dish", async () => {
    const seen: string[] = []
    let after: Record<string, unknown> = {}
    for (let i = 0; i < 6; i++) {
      const page = await staffList(w.staff1, { ...after, p_limit: 2 })
      if (page.length === 0) break
      seen.push(...page.map((r) => r.name))
      const last = page[page.length - 1]!
      after = {
        p_after_needed_by: last.needed_by,
        p_after_section_position: last.section_position,
        p_after_entry_position: last.entry_position,
        p_after_item_id: last.item_id,
      }
    }
    expect(seen).toEqual(["Dal", "Lassi", "Korma", "Tikka", "Bhaji"])
    const managerSeen: string[] = []
    after = {}
    for (let i = 0; i < 6; i++) {
      const page = await managerList(w.mgr, { ...after, p_limit: 3 })
      if (page.length === 0) break
      managerSeen.push(...page.map((r) => r.name))
      const last = page[page.length - 1]!
      after = {
        p_after_needed_by: last.needed_by,
        p_after_section_position: last.section_position,
        p_after_entry_position: last.entry_position,
        p_after_item_id: last.item_id,
      }
    }
    expect(managerSeen).toEqual(["Dal", "Lassi", "Korma", "Tikka", "Bhaji"])
  })

  it("after the date the dish stays first, marked passed, never overdue", async () => {
    const dal = id(w, "mains--dal")
    const { error } = await service
      .from("menu_item_needed_by" as never)
      .update({ needed_by: londonDay(-3) } as never)
      .eq("item_id", dal)
    if (error) throw error
    const [first, second] = await staffList(w.staff1, { p_gaps_only: true })
    expect(first).toMatchObject({
      name: "Dal",
      needed_by: londonDay(-3),
      needed_by_passed: true,
    })
    expect(second).toMatchObject({ name: "Lassi", needed_by_passed: false })
    const [mFirst] = await managerList(w.mgr)
    expect(mFirst).toMatchObject({ name: "Dal", needed_by_passed: true })
    expect(Object.keys(mFirst!).some((k) => /overdue/i.test(k))).toBe(false)
  })

  it("clears when a photo of the dish is accepted, and a withdrawal does not bring it back", async () => {
    const dal = id(w, "mains--dal")
    const accepted = await acceptedPhoto(w, w.staff1, w.mgr, dal)
    const gaps = await staffList(w.staff1, { p_gaps_only: true })
    expect(gaps.map((r) => r.name)).toEqual([
      "Lassi",
      "Korma",
      "Tikka",
      "Bhaji",
    ])
    const all = await staffList(w.staff1)
    expect(all.find((r) => r.name === "Dal")).toMatchObject({ needed_by: null })
    await ok(
      w.mgr.client.rpc("withdraw_menu_item_photo", {
        p_photo_id: accepted.photo_id,
        p_expected_revision: await head(dal),
        p_reason: "TEST withdraw",
      })
    )
    const after = await staffList(w.staff1, { p_gaps_only: true })
    expect(after.map((r) => [r.name, r.needed_by])).toEqual([
      ["Lassi", londonDay(6)],
      ["Korma", null],
      ["Tikka", null],
      ["Dal", null],
      ["Bhaji", null],
    ])
    // Clearing an already-cleared date by hand changes nothing.
    const [cleared] = await ok(clearNeeded(w.mgr, dal))
    expect(cleared).toMatchObject({ cleared: false })
    // It can be set again now the dish is still needed.
    await ok(setNeeded(w.mgr, dal, londonDay(1)))
    expect((await staffList(w.staff1))[0]).toMatchObject({
      name: "Dal",
      needed_by: londonDay(1),
    })
  })
})
