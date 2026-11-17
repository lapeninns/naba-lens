// Album AL-4 slot briefs (20261117130000_album_briefs.sql): who may set and
// clear a section's or a dish's brief, who may read them, which slots they
// may go on, and that the history is append-only. Real signed-in identities
// through PostgREST; the service role only builds fixtures and reads back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
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
  psql,
} from "./coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

const service = serviceClient()
let admin: TestIdentity

const MENU = () =>
  menu("TEST briefs", [
    section("mains", "Mains", [
      item("mains--korma", "Korma"),
      item("mains--dal", "Dal"),
    ]),
    section("drinks", "Drinks", [item("drinks--lassi", "Lassi")], "drinks"),
  ])

type World = {
  venue: string
  items: Record<string, CatalogueRow>
  staff1: TestIdentity
  mgr: TestIdentity
  grantee: TestIdentity
}

type Briefs = {
  venueId: string
  items: { source: string; key: string; brief: string }[]
  amenities: { key: string; brief: string }[]
}

type Rpc<T> = PromiseLike<{
  data: T | null
  error: { message: string; code: string; details?: string } | null
}>

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
  return { venue, items, staff1, mgr, grantee }
}

function setBrief(
  who: TestIdentity,
  source: string,
  key: string,
  brief: string | null,
  venue?: string
) {
  return who.client.rpc(
    "album_brief_set" as never,
    {
      p_venue_id: venue ?? null,
      p_source: source,
      p_key: key,
      p_brief: brief,
    } as never
  ) as unknown as Rpc<{ changed: boolean; brief: string | null }>
}

function readBriefs(who: TestIdentity, venue?: string) {
  return who.client.rpc(
    "album_briefs" as never,
    (venue ? { p_venue_id: venue } : {}) as never
  ) as unknown as Rpc<Briefs>
}

async function events(venue: string) {
  const { data, error } = await service
    .from("album_brief_events" as never)
    .select("id, source, source_key, brief")
    .eq("venue_id", venue)
    .order("id")
  if (error) throw error
  return (data ?? []) as unknown as {
    id: number
    source: string
    source_key: string
    brief: string | null
  }[]
}

const id = (w: World, key: string) => w.items[key]!.itemId

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "briefs-admin",
    role: "admin",
  })
})

describe("album briefs", () => {
  let w: World
  let other: World

  beforeAll(async () => {
    ;[w, other] = await Promise.all([world("briefs-a"), world("briefs-b")])
  })

  it("lets the manager set, change and clear a section and a dish brief", async () => {
    const set = await ok(
      setBrief(
        w.mgr,
        "menu_section",
        "mains",
        "  The plate from above, garnish on  "
      )
    )
    expect(set).toMatchObject({
      changed: true,
      brief: "The plate from above, garnish on",
    })
    // The same brief again changes nothing and writes no event.
    expect(
      await ok(
        setBrief(
          w.mgr,
          "menu_section",
          "mains",
          "The plate from above, garnish on"
        )
      )
    ).toMatchObject({ changed: false })

    await ok(
      setBrief(
        w.mgr,
        "menu_item",
        id(w, "mains--korma"),
        "Korma in its copper pot"
      )
    )
    await ok(
      setBrief(
        w.mgr,
        "menu_item",
        id(w, "mains--korma"),
        "Korma with rice beside it"
      )
    )

    const read = await ok(readBriefs(w.staff1))
    expect(read.venueId).toBe(w.venue)
    expect(read.items).toEqual(
      expect.arrayContaining([
        {
          source: "menu_section",
          key: "mains",
          brief: "The plate from above, garnish on",
        },
        {
          source: "menu_item",
          key: id(w, "mains--korma"),
          brief: "Korma with rice beside it",
        },
      ])
    )
    expect(read.items).toHaveLength(2)

    // Blank clears, like null.
    expect(
      await ok(setBrief(w.mgr, "menu_item", id(w, "mains--korma"), "   "))
    ).toMatchObject({ changed: true, brief: null })
    expect(
      await ok(setBrief(w.mgr, "menu_item", id(w, "mains--korma"), null))
    ).toMatchObject({ changed: false })
    expect((await ok(readBriefs(w.staff1))).items).toHaveLength(1)

    expect((await events(w.venue)).map((e) => [e.source, e.brief])).toEqual([
      ["menu_section", "The plate from above, garnish on"],
      ["menu_item", "Korma in its copper pot"],
      ["menu_item", "Korma with rice beside it"],
      ["menu_item", null],
    ])
  })

  it("lets a grant holder and an admin (naming the venue) write", async () => {
    await ok(
      setBrief(
        w.grantee,
        "menu_section",
        "drinks",
        "The glass on the bar, label out"
      )
    )
    await ok(
      setBrief(
        admin,
        "menu_item",
        id(w, "drinks--lassi"),
        "Lassi in a tall glass",
        w.venue
      )
    )
    await fails(
      setBrief(admin, "menu_section", "drinks", "No venue"),
      "venue_required"
    )
    const read = await ok(readBriefs(admin, w.venue))
    expect(read.items.map((i) => i.key)).toEqual(
      expect.arrayContaining(["drinks", id(w, "drinks--lassi")])
    )
  })

  it("refuses staff, anon and another venue's manager", async () => {
    await fails(
      setBrief(w.staff1, "menu_section", "mains", "Staff brief"),
      "not_venue_manager"
    )
    await fails(
      setBrief(other.mgr, "menu_section", "mains", "Wrong venue", w.venue),
      "not_venue_manager"
    )
    // Another venue's dish is not a slot at the manager's own venue.
    await fails(
      setBrief(other.mgr, "menu_item", id(w, "mains--dal"), "Not mine"),
      "unknown_slot"
    )
    // Reads: another venue's staff and manager are refused.
    await fails(readBriefs(other.staff1, w.venue), "wrong_venue")
    await fails(readBriefs(other.mgr, w.venue), "wrong_venue")
    // Other venue's own read does not see this venue's briefs.
    expect((await ok(readBriefs(other.staff1))).items).toEqual([])

    const anon = anonClient()
    const { error: anonRead } = await anon.rpc(
      "album_briefs" as never,
      {} as never
    )
    expect(anonRead).not.toBeNull()
    const { error: anonWrite } = await anon.rpc(
      "album_brief_set" as never,
      {
        p_venue_id: w.venue,
        p_source: "menu_section",
        p_key: "mains",
        p_brief: "x",
      } as never
    )
    expect(anonWrite).not.toBeNull()

    // No direct table access for signed-in users.
    const { data: direct } = await w.mgr.client
      .from("album_briefs" as never)
      .select("*")
    expect(direct ?? []).toEqual([])
  })

  it("checks the source, the key and the brief", async () => {
    await fails(
      setBrief(w.mgr, "amenity_category", "Games", "x"),
      "invalid_source"
    )
    await fails(setBrief(w.mgr, "menu_section", "  ", "x"), "invalid_key")
    await fails(
      setBrief(w.mgr, "menu_section", "puddings", "x"),
      "unknown_slot"
    )
    await fails(setBrief(w.mgr, "menu_item", "not-a-dish", "x"), "unknown_slot")
    await fails(
      setBrief(w.mgr, "menu_section", "mains", "x".repeat(141)),
      "invalid_brief"
    )
    await fails(
      setBrief(w.mgr, "menu_section", "mains", "Two\nlines"),
      "invalid_brief"
    )
    // Tabs and other control characters too, not only line breaks.
    for (const brief of ["Tab\there", "Bell\u0007here", "Del\u007fhere"])
      await fails(
        setBrief(w.mgr, "menu_section", "mains", brief),
        "invalid_brief"
      )
    // Characters, not UTF-16 units: 140 emoji is a full brief.
    expect(
      await ok(setBrief(w.mgr, "menu_section", "mains", "🍛".repeat(140)))
    ).toMatchObject({ changed: true })
    await fails(
      setBrief(w.mgr, "menu_section", "mains", "🍛".repeat(141)),
      "invalid_brief"
    )
    expect(
      await ok(setBrief(w.mgr, "menu_section", "drinks", "y".repeat(140)))
    ).toMatchObject({ changed: true })
  })

  it("checks permission before the input", async () => {
    // Staff, here and at another venue, learn nothing about the input.
    for (const who of [w.staff1, other.staff1])
      await fails(
        setBrief(who, "menu_section", "mains", "y".repeat(141), w.venue),
        "not_venue_manager"
      )
    await fails(
      setBrief(other.mgr, "menu_section", "x".repeat(121), "x", w.venue),
      "not_venue_manager"
    )
  })

  it("keeps the history append-only", async () => {
    const [first] = await events(w.venue)
    expect(first).toBeDefined()
    expect(() =>
      psql(
        `update public.album_brief_events set brief = 'changed' where id = ${first!.id}`
      )
    ).toThrow()
    expect(() =>
      psql(`delete from public.album_brief_events where id = ${first!.id}`)
    ).toThrow()
    expect((await events(w.venue))[0]!.brief).toBe(first!.brief)
  })

  it("reads the catalogue's capture brief for each amenity the venue has", async () => {
    expect((await ok(readBriefs(w.staff1))).amenities).toEqual([])
    await ok(admin.client.rpc("amenity_enable_venue", { p_venue_id: w.venue }))
    const read = await ok(readBriefs(w.staff1))
    expect(read.amenities.length).toBeGreaterThan(0)
    for (const amenity of read.amenities) {
      expect(amenity.key).toMatch(/^[a-z0-9_]+$/)
      expect(amenity.brief.length).toBeGreaterThan(0)
    }
  })
})
