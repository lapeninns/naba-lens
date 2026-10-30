// v0.3 packet H: admin library label filters, proved as real signed-in users
// through the app's own read path (lib/server/media/library) over PostgREST.
// The service role only arranges state (ready, tombstone) and psql only moves
// created_at for the date-boundary assets (local stack only).
import { execFileSync } from "node:child_process"

import { beforeAll, describe, expect, it, vi } from "vitest"

import { MEDIA_LIMITS } from "../../lib/config/media"
import {
  listLibrary,
  listOwnMedia,
  parseLibraryFilters,
  type AdminLibraryFilters,
} from "../../lib/server/media/library"
import {
  libraryLabelFilterOptions,
  NOT_ON_ACTIVE_MENU,
} from "../../lib/server/media/library-labels"
import type { MediaActor, MediaItemView } from "../../lib/server/media/types"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { actorFor } from "../slice/media-actor"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserve,
  reserveReady,
  saveOk,
  section,
  type SaveArgs,
} from "./menus-fixtures"

// Lets one test make the label read fail, as an outage would.
const labelRead = vi.hoisted(() => ({ fail: false }))
vi.mock("@/lib/server/labels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/labels")>()
  return {
    ...actual,
    tryLoadLabelSummaries: (
      ...args: Parameters<typeof actual.tryLoadLabelSummaries>
    ) =>
      labelRead.fail
        ? Promise.resolve(null)
        : actual.tryLoadLabelSummaries(...args),
  }
})

const service = serviceClient()
const PAGE = MEDIA_LIMITS.pageSize

const NONE: AdminLibraryFilters = parseLibraryFilters({})

let venueA: string
let venueB: string
let admin: TestIdentity
let staffA: TestIdentity
let staffA2: TestIdentity
let staffP: TestIdentity
let staffB: TestIdentity
let adminActor: MediaActor
let v1: string

const ids = {} as Record<
  | "curry"
  | "dal"
  | "samosa"
  | "bhaji"
  | "papadum"
  | "special"
  | "chicken"
  | "lamb"
  | "tarka"
  | "curryB",
  string
>
const a = {} as Record<
  | "a1"
  | "a2"
  | "a3"
  | "a4"
  | "a5"
  | "a6"
  | "a7"
  | "a9"
  | "a10"
  | "b1"
  | "d1"
  | "d2"
  | "d3"
  | "d4"
  | "uploading"
  | "processing",
  string
>
const paged: string[] = []

function setCreatedAt(assetId: string, iso: string) {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  if (!/^[0-9a-f-]{36}$/.test(assetId) || Number.isNaN(Date.parse(iso))) {
    throw new Error("bad fixture")
  }
  execFileSync(
    "psql",
    [
      url,
      "-v",
      "ON_ERROR_STOP=1",
      "-qAtc",
      `set session_replication_role = replica; update public.media_assets set created_at = '${iso}' where id = '${assetId}'`,
    ],
    { encoding: "utf8" }
  )
}

async function labelled(
  staff: TestIdentity,
  args: Omit<SaveArgs, "asset" | "revision">,
  mediaType: "image" | "video" = "image",
  catalogue: string | null = v1
) {
  const asset = await reserveReady(service, staff, mediaType)
  await saveOk(staff, { asset: asset.id, revision: 0, catalogue, ...args })
  return asset.id
}

/** Every page of the library with these filters, checking order and uniqueness. */
async function everything(
  filters: Partial<AdminLibraryFilters>,
  actor = adminActor
): Promise<MediaItemView[]> {
  const all: MediaItemView[] = []
  let cursor: string | null = null
  for (let i = 0; i < 20; i++) {
    const page = await listLibrary(actor, { ...NONE, ...filters }, cursor)
    if (!page.ok) throw new Error(`${page.status} ${page.message}`)
    all.push(...page.items)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  const seen = new Set(all.map((i) => i.id))
  expect(seen.size, "no asset twice").toBe(all.length)
  for (let i = 1; i < all.length; i++) {
    const [p, n] = [all[i - 1], all[i]]
    const before =
      p.createdAt > n.createdAt || (p.createdAt === n.createdAt && p.id > n.id)
    expect(before, "strict (created_at, id) desc order").toBe(true)
  }
  return all
}

/**
 * Matching ids among this run's assets (the stack keeps other suites' and
 * earlier runs' rows, which filters without a venue would also see).
 */
const idsOf = async (filters: Partial<AdminLibraryFilters>) => {
  const mine = new Set([...Object.values(a), ...paged])
  return (await everything(filters))
    .map((i) => i.id)
    .filter((id) => mine.has(id))
    .sort()
}
const sorted = (...list: string[]) => [...list].sort()

beforeAll(async () => {
  venueA = (await createVenue(service, "lib-a")).id
  venueB = (await createVenue(service, "lib-b")).id
  admin = await createIdentity(service, { label: "lib-admin", role: "admin" })
  staffA = await createIdentity(service, {
    label: "lib-staff-a",
    role: "staff",
    venueId: venueA,
  })
  staffA2 = await createIdentity(service, {
    label: "lib-staff-a2",
    role: "staff",
    venueId: venueA,
  })
  staffP = await createIdentity(service, {
    label: "lib-staff-p",
    role: "staff",
    venueId: venueA,
  })
  staffB = await createIdentity(service, {
    label: "lib-staff-b",
    role: "staff",
    venueId: venueB,
  })
  adminActor = await actorFor(admin)

  v1 = await publishMenu(
    admin,
    venueA,
    menu("TEST Library menu v1", [
      section("curries", "Curries", [
        item("curries--house-curry", "House Curry", {
          aliases: ["Chef's curry"],
          variants: ["Chicken", "Lamb"],
        }),
        item("curries--house-dal", "House Dal", {
          variants: ["Tarka", "Makhani"],
        }),
      ]),
      section("starters", "Starters", [
        item("starters--house-samosa", "House Samosa"),
        item("starters--onion-bhaji", "Onion Bhaji"),
        item("starters--papadum", "Papadum"),
      ]),
      section("specials", "Specials", [
        item("specials--chef-special", "Chef Special"),
      ]),
    ])
  )
  const doc = await readDocument(service, v1)
  const k = doc.byKey
  ids.curry = k["curries--house-curry"].itemId
  ids.dal = k["curries--house-dal"].itemId
  ids.samosa = k["starters--house-samosa"].itemId
  ids.bhaji = k["starters--onion-bhaji"].itemId
  ids.papadum = k["starters--papadum"].itemId
  ids.special = k["specials--chef-special"].itemId
  const variant = (key: string, name: string) =>
    k[key].variants.find((v) => v.name === name)!.variantId
  ids.chicken = variant("curries--house-curry", "Chicken")
  ids.lamb = variant("curries--house-curry", "Lamb")
  ids.tarka = variant("curries--house-dal", "Tarka")

  const vB = await publishMenu(
    admin,
    venueB,
    menu("TEST Library menu B", [
      section("curries", "Curries", [
        item("curries--house-curry", "House Curry"),
      ]),
    ])
  )
  ids.curryB = (await readDocument(service, vB)).byKey[
    "curries--house-curry"
  ].itemId

  const one = (itemId: string, variantId: string | null = null) => ({
    itemId,
    variantId,
  })
  a.a1 = await labelled(staffA, {
    items: [one(ids.curry, ids.chicken)],
    types: ["dish"],
    note: "Friday special",
  })
  a.a2 = await labelled(
    staffA,
    { items: [one(ids.curry, ids.lamb)], types: ["plating"] },
    "video"
  )
  a.a3 = await labelled(staffA, {
    items: [one(ids.curry), one(ids.dal), one(ids.samosa)],
    types: ["dish", "preparation"],
    note: "Big platter",
  })
  a.a4 = await labelled(staffA2, { items: [one(ids.bhaji)] })
  // Ready, never labelled.
  a.a5 = (await reserveReady(service, staffA, "video")).id
  // A label row with only a note is still "needs labels".
  a.a6 = await labelled(staffA, { note: "needs a retake" })
  // Labelled, then deleted.
  a.a7 = await labelled(staffA, {
    items: [one(ids.curry)],
    types: ["dish"],
    note: "Friday special",
  })
  // Item and variant on different tuples.
  a.a9 = await labelled(staffA, {
    items: [one(ids.curry), one(ids.dal, ids.tarka)],
  })
  a.a10 = await labelled(staffA, { items: [one(ids.special)], types: ["dish"] })
  a.b1 = await labelled(
    staffB,
    {
      items: [one(ids.curryB)],
      types: ["dish"],
      note: "Friday special",
    },
    "image",
    vB
  )
  for (const key of ["d1", "d2", "d3", "d4"] as const) {
    a[key] = await labelled(staffA, { types: ["team"] })
  }
  // Around the end of BST on Sunday 2026-10-25 (London days in comments).
  setCreatedAt(a.d1, "2026-10-24T22:59:59.999Z") // 24th 23:59:59.999 BST
  setCreatedAt(a.d2, "2026-10-24T23:00:00.000Z") // 25th 00:00 BST
  setCreatedAt(a.d3, "2026-10-25T23:59:59.999Z") // 25th 23:59:59.999 GMT
  setCreatedAt(a.d4, "2026-10-26T00:00:00.000Z") // 26th 00:00 GMT

  a.uploading = (await reserve(staffA)).id
  const processing = await reserve(staffA)
  a.processing = processing.id
  {
    const { error } = await service
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", processing.id)
    if (error) throw error
  }
  {
    const { error } = await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", a.a7)
    if (error) throw error
  }

  // More matching assets than one page holds.
  for (let i = 0; i < PAGE + 5; i += 6) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(6, PAGE + 5 - i) }, () =>
        labelled(staffP, { types: ["event"] })
      )
    )
    paged.push(...batch)
  }

  // v2: House Curry renamed, Onion Bhaji moved to a new Sides section, House
  // Samosa and the whole Specials section dropped.
  const keep = (key: string, name = k[key].name) =>
    item(key, name, {
      itemId: k[key].itemId,
      variants: k[key].variants,
      ...(key === "curries--house-curry" ? { aliases: ["Chef's curry"] } : {}),
    })
  await publishMenu(
    admin,
    venueA,
    menu("TEST Library menu v2", [
      section("curries", "Curries", [
        keep("curries--house-curry", "Royal Curry"),
        keep("curries--house-dal"),
      ]),
      section("starters", "Starters", [keep("starters--papadum")]),
      section("sides", "Sides", [keep("starters--onion-bhaji")]),
    ]),
    v1
  )
}, 180_000)

describe("admin library label filters (H)", () => {
  it("is admin only, for pages and filter options", async () => {
    const staff = await actorFor(staffA)
    expect(
      await listLibrary(staff, { ...NONE, itemId: ids.curry })
    ).toMatchObject({ ok: false, status: 403 })
    expect(await libraryLabelFilterOptions(staff, venueA)).toEqual({
      categories: [],
      items: [],
    })
    expect(await libraryLabelFilterOptions(adminActor, null)).toEqual({
      categories: [],
      items: [],
    })
  })

  it("lists only ready, non-deleted assets, with labels attached", async () => {
    const everyA = [
      a.a1,
      a.a2,
      a.a3,
      a.a4,
      a.a5,
      a.a6,
      a.a9,
      a.a10,
      a.d1,
      a.d2,
      a.d3,
      a.d4,
      ...paged,
    ]
    expect(await idsOf({ venueId: venueA })).toEqual(sorted(...everyA))
    for (const filters of [
      { venueId: venueA, labelState: "unlabelled" as const },
      { venueId: venueA, query: "friday" },
      { venueId: venueA, itemId: ids.curry },
      { venueId: venueA, contentType: "dish" as const },
    ]) {
      const got = await idsOf(filters)
      for (const hidden of [a.a7, a.uploading, a.processing]) {
        expect(got).not.toContain(hidden)
      }
    }
    const page = await listLibrary(adminActor, { ...NONE, venueId: venueA })
    if (!page.ok) throw new Error(page.message)
    for (const view of page.items) expect(view.labels).not.toBeNull()

    const one = (
      await everything({ itemId: ids.curry, variantId: ids.chicken })
    )[0]
    expect(one.id).toBe(a.a1)
    expect(one.labels).toMatchObject({
      hasLabels: true,
      contentTypes: ["dish"],
      note: "Friday special",
      items: [
        {
          itemId: ids.curry,
          variantId: ids.chicken,
          name: "Royal Curry",
          labelledAs: "House Curry, Chicken",
          variantName: "Chicken",
        },
      ],
    })
    const unlabelled = (
      await everything({ venueId: venueA, labelState: "unlabelled" })
    ).find((v) => v.id === a.a5)
    expect(unlabelled?.labels).toMatchObject({ hasLabels: false, items: [] })
  })

  it("filters by menu item, alone and with venue, staff and type", async () => {
    const curry = [a.a1, a.a2, a.a3, a.a9]
    expect(await idsOf({ itemId: ids.curry })).toEqual(sorted(...curry))
    expect(await idsOf({ itemId: ids.curry, venueId: venueA })).toEqual(
      sorted(...curry)
    )
    expect(await idsOf({ itemId: ids.curry, venueId: venueB })).toEqual([])
    expect(await idsOf({ itemId: ids.curry, staffId: staffA2.id })).toEqual([])
    expect(await idsOf({ itemId: ids.curry, type: "video" })).toEqual([a.a2])
    expect(await idsOf({ itemId: ids.bhaji, staffId: staffA2.id })).toEqual([
      a.a4,
    ])
    expect(await idsOf({ itemId: ids.curryB })).toEqual([a.b1])
  })

  it("matches item and variant on the same label tuple", async () => {
    expect(await idsOf({ variantId: ids.chicken })).toEqual([a.a1])
    expect(await idsOf({ itemId: ids.curry, variantId: ids.chicken })).toEqual([
      a.a1,
    ])
    // a9 has House Curry and (House Dal, Tarka): not the tuple (Curry, Tarka).
    expect(await idsOf({ itemId: ids.curry, variantId: ids.tarka })).toEqual([])
    expect(await idsOf({ itemId: ids.dal, variantId: ids.tarka })).toEqual([
      a.a9,
    ])
  })

  it("filters by category, by snapshot and after a category move", async () => {
    expect(await idsOf({ venueId: venueA, category: "curries" })).toEqual(
      sorted(a.a1, a.a2, a.a3, a.a9)
    )
    // Snapshot slugs: Samosa (dropped) and Bhaji (moved) were starters.
    expect(await idsOf({ venueId: venueA, category: "starters" })).toEqual(
      sorted(a.a3, a.a4)
    )
    // The active version's section.
    expect(await idsOf({ venueId: venueA, category: "sides" })).toEqual([a.a4])
    // A section that only retired versions had.
    expect(await idsOf({ category: "specials", venueId: venueA })).toEqual([
      a.a10,
    ])
    expect(await idsOf({ category: "curries", venueId: venueB })).toEqual([
      a.b1,
    ])
  })

  it("filters by content type, with venue and date", async () => {
    expect(await idsOf({ venueId: venueA, contentType: "dish" })).toEqual(
      sorted(a.a1, a.a3, a.a10)
    )
    expect(await idsOf({ contentType: "dish" })).toEqual(
      sorted(a.a1, a.a3, a.a10, a.b1)
    )
    expect(await idsOf({ contentType: "plating", type: "video" })).toEqual([
      a.a2,
    ])
    expect(
      await idsOf({ contentType: "team", from: "2026-10-25", to: "2026-10-25" })
    ).toEqual(sorted(a.d2, a.d3))
  })

  it("filters labelled and needs-labels assets", async () => {
    expect(await idsOf({ venueId: venueA, labelState: "labelled" })).toEqual(
      sorted(
        a.a1,
        a.a2,
        a.a3,
        a.a4,
        a.a9,
        a.a10,
        a.d1,
        a.d2,
        a.d3,
        a.d4,
        ...paged
      )
    )
    expect(await idsOf({ venueId: venueA, labelState: "unlabelled" })).toEqual(
      sorted(a.a5, a.a6)
    )
    expect(
      await idsOf({ venueId: venueA, labelState: "unlabelled", type: "video" })
    ).toEqual([a.a5])
  })

  it("searches notes, snapshots, current and historical names and aliases", async () => {
    const curry = sorted(a.a1, a.a2, a.a3, a.a9)
    expect(await idsOf({ query: "friday" })).toEqual(sorted(a.a1, a.b1))
    expect(await idsOf({ query: "FRIDAY", venueId: venueA })).toEqual([a.a1])
    // Renamed: the current name and the name it was labelled with.
    expect(await idsOf({ venueId: venueA, query: "royal curry" })).toEqual(
      curry
    )
    expect(await idsOf({ venueId: venueA, query: "house curry" })).toEqual(
      curry
    )
    expect(await idsOf({ venueId: venueA, query: "chef's" })).toEqual(curry)
    // A dropped item, found by its snapshot.
    expect(await idsOf({ venueId: venueA, query: "samosa" })).toEqual([a.a3])
    // A note on an asset that still needs labels.
    expect(await idsOf({ query: "retake" })).toEqual([a.a6])
    expect(await idsOf({ query: "retake", labelState: "labelled" })).toEqual([])
    // Wildcards are literal text.
    expect(await idsOf({ venueId: venueA, query: "%" })).toEqual([])
    expect(await idsOf({ venueId: venueA, query: "_" })).toEqual([])
  })

  it("lists an asset matching several items once", async () => {
    // a3 has House Curry, House Dal and House Samosa: all three match.
    const house = await everything({ venueId: venueA, query: "house" })
    expect(house.filter((v) => v.id === a.a3)).toHaveLength(1)
    expect(house.map((v) => v.id).sort()).toEqual(
      sorted(a.a1, a.a2, a.a3, a.a9)
    )
    const curries = await everything({ venueId: venueA, category: "curries" })
    expect(curries.filter((v) => v.id === a.a3)).toHaveLength(1)
  })

  it("filters by inclusive Europe/London days across the BST change", async () => {
    const day = (from: string, to: string) =>
      idsOf({ venueId: venueA, from, to })
    expect(await day("2026-10-25", "2026-10-25")).toEqual(sorted(a.d2, a.d3))
    expect(await day("2026-10-24", "2026-10-24")).toEqual([a.d1])
    expect(await day("2026-10-26", "2026-10-26")).toEqual([a.d4])
    expect(await day("2026-10-24", "2026-10-26")).toEqual(
      sorted(a.d1, a.d2, a.d3, a.d4)
    )
    // Reversed ranges are swapped by the parser.
    const swapped = parseLibraryFilters({
      venue: venueA,
      from: "2026-10-26",
      to: "2026-10-25",
    })
    const page = await listLibrary(adminActor, swapped)
    if (!page.ok) throw new Error(page.message)
    expect(page.items.map((v) => v.id).sort()).toEqual(sorted(a.d2, a.d3, a.d4))
    expect(await idsOf({ venueId: venueA, to: "2026-10-24" })).toEqual([a.d1])
    expect(
      await idsOf({
        venueId: venueA,
        from: "2026-10-26",
        labelState: "unlabelled",
      })
    ).toEqual(sorted(a.a5, a.a6))
  })

  it("pages a label filter stably, with no duplicates or gaps", async () => {
    const filters = { ...NONE, venueId: venueA, contentType: "event" as const }
    const first = await listLibrary(adminActor, filters)
    if (!first.ok) throw new Error(first.message)
    expect(first.items).toHaveLength(PAGE)
    expect(first.nextCursor).not.toBeNull()
    const second = await listLibrary(adminActor, filters, first.nextCursor)
    if (!second.ok) throw new Error(second.message)
    expect(second.items).toHaveLength(5)
    expect(second.nextCursor).toBeNull()
    const both = [...first.items, ...second.items].map((v) => v.id)
    expect(new Set(both).size).toBe(PAGE + 5)
    expect([...both].sort()).toEqual(sorted(...paged))
    // The walk checks order across the page boundary too.
    expect(
      await idsOf({ staffId: staffP.id, labelState: "labelled", type: "image" })
    ).toEqual(sorted(...paged))
    // A fresh first page with the same filters (the 15 s refresh) is the same.
    const again = await listLibrary(adminActor, filters)
    if (!again.ok) throw new Error(again.message)
    expect(again.items.map((v) => v.id)).toEqual(first.items.map((v) => v.id))
  })

  it("ignores invalid params instead of failing or filtering", async () => {
    const junk = parseLibraryFilters({
      venue: venueA,
      item: "not-a-uuid",
      variant: `${ids.chicken}),or(id.gt.0`,
      category: "Curries!",
      content: "food",
      labels: "maybe",
      q: "   ",
      from: "2026-02-30",
      to: "tomorrow",
    })
    expect(junk).toEqual({ ...NONE, venueId: venueA })
    const page = await listLibrary(adminActor, junk)
    const plain = await listLibrary(adminActor, { ...NONE, venueId: venueA })
    if (!page.ok || !plain.ok) throw new Error("page failed")
    expect(page.items.map((v) => v.id)).toEqual(plain.items.map((v) => v.id))
    // Unknown but well-formed ids match nothing.
    expect(
      await idsOf({ itemId: crypto.randomUUID(), venueId: venueA })
    ).toEqual([])
    expect(
      await listLibrary(adminActor, { ...NONE, itemId: ids.curry }, "bad")
    ).toMatchObject({ ok: false, status: 400 })
  })

  it("keeps the page when labels cannot be read", async () => {
    labelRead.fail = true
    try {
      const page = await listLibrary(adminActor, {
        ...NONE,
        venueId: venueA,
        itemId: ids.curry,
      })
      if (!page.ok) throw new Error(page.message)
      expect(page.items.map((v) => v.id).sort()).toEqual(
        sorted(a.a1, a.a2, a.a3, a.a9)
      )
      for (const view of page.items) expect(view.labels).toBeNull()
      const own = await listOwnMedia(await actorFor(staffA))
      if (!own.ok) throw new Error(own.message)
      for (const view of own.items) expect(view.labels).toBeNull()
    } finally {
      labelRead.fail = false
    }
  })

  it("loads labels for the staff portfolio: ready only", async () => {
    const own = await listOwnMedia(await actorFor(staffA))
    if (!own.ok) throw new Error(own.message)
    const byId = new Map(own.items.map((v) => [v.id, v]))
    expect(byId.get(a.uploading)?.labels).toBeNull()
    expect(byId.get(a.processing)?.labels).toBeNull()
    expect(byId.get(a.a5)?.labels).toMatchObject({ hasLabels: false })
    expect(byId.get(a.a3)?.labels?.items).toHaveLength(3)
    expect(byId.has(a.a7)).toBe(false)
  })

  it("offers the active menu plus items and categories only labels still use", async () => {
    const options = await libraryLabelFilterOptions(adminActor, venueA)
    expect(options.categories).toEqual([
      { slug: "curries", name: "Curries" },
      { slug: "starters", name: "Starters" },
      { slug: "sides", name: "Sides" },
      { slug: "specials", name: `Specials ${NOT_ON_ACTIVE_MENU}` },
    ])
    expect(options.items).toEqual([
      {
        id: ids.curry,
        name: "Royal Curry",
        sectionName: "Curries",
        variants: [
          { id: ids.chicken, name: "Chicken" },
          { id: ids.lamb, name: "Lamb" },
        ],
      },
      {
        id: ids.dal,
        name: "House Dal",
        sectionName: "Curries",
        variants: [
          { id: ids.tarka, name: "Tarka" },
          expect.objectContaining({ name: "Makhani" }),
        ],
      },
      {
        id: ids.papadum,
        name: "Papadum",
        sectionName: "Starters",
        variants: [],
      },
      {
        id: ids.bhaji,
        name: "Onion Bhaji",
        sectionName: "Sides",
        variants: [],
      },
      {
        id: ids.special,
        name: "Chef Special",
        sectionName: `Specials ${NOT_ON_ACTIVE_MENU}`,
        variants: [],
      },
      {
        id: ids.samosa,
        name: "House Samosa",
        sectionName: `Starters ${NOT_ON_ACTIVE_MENU}`,
        variants: [],
      },
    ])
    const b = await libraryLabelFilterOptions(adminActor, venueB)
    expect(b.items.map((i) => i.id)).toEqual([ids.curryB])
  })
})
