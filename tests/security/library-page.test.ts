// Workstream 3 fixes 1, 3 and 4: public.library_page (the app's library read)
// against the references it replaced, as real signed-in users over PostgREST.
//
// Reference ("old") = what listLibrary sent before: public.library_assets (or
// the media_assets table without label filters) plus the PostgREST filters and
// the `or(created_at.lt, and(created_at.eq, id.lt))` cursor. New = library_page.
// Every filter combination is walked page by page through the cursor (pages of
// 5, so boundaries fall inside groups of equal created_at) and the id lists
// must match page for page. Both strategies are forced: p_candidate_cap 0 always
// walks the feed index, 20000 reads the matching asset ids first.
import { execFileSync } from "node:child_process"

import { beforeAll, describe, expect, it } from "vitest"

import { actorFor } from "../slice/media-actor"
import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { libraryLabelFilterOptions } from "../../lib/server/media/library-labels"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserve,
  reserveReady,
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

const service = serviceClient()

type Combo = {
  venue?: string
  staff?: string
  type?: "image" | "video"
  from?: string
  to?: string
  item?: string
  variant?: string
  category?: string
  content?: string
  state?: string
  query?: string
}

type Feed<Q> = {
  eq(column: string, value: string): Q
  gte(column: string, value: string): Q
  lt(column: string, value: string): Q
  or(filters: string): Q
  order(column: string, options: { ascending: boolean }): Q
  limit(count: number): PromiseLike<{
    data: { id: string; created_at: string }[] | null
    error: { message: string } | null
  }>
}

type Row = { id: string; created_at: string }

const SEL = "id, created_at, media_type"
const PAGE = 5

function setCreatedAt(rows: [string, string][]) {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  const values = rows
    .map(([id, iso]) => {
      if (!/^[0-9a-f-]{36}$/.test(id) || Number.isNaN(Date.parse(iso))) {
        throw new Error("bad fixture")
      }
      return `('${id}'::uuid, '${iso}'::timestamptz)`
    })
    .join(", ")
  execFileSync(
    "psql",
    [
      url,
      "-v",
      "ON_ERROR_STOP=1",
      "-qAtc",
      `set session_replication_role = replica; update public.media_assets a set created_at = v.t from (values ${values}) as v(id, t) where a.id = v.id`,
    ],
    { encoding: "utf8" }
  )
}

function applyFeed<Q extends Feed<Q>>(
  query: Q,
  c: Combo,
  after: { created_at: string; id: string } | null
): Q {
  let next = query.eq("upload_state", "ready")
  if (c.venue) next = next.eq("venue_id", c.venue)
  if (c.staff) next = next.eq("uploader_id", c.staff)
  if (c.type) next = next.eq("media_type", c.type)
  if (c.from) next = next.gte("created_at", c.from)
  if (c.to) next = next.lt("created_at", c.to)
  if (after) {
    next = next.or(
      `created_at.lt."${after.created_at}",and(created_at.eq."${after.created_at}",id.lt.${after.id})`
    )
  }
  return next
}

async function oldPage(
  user: TestIdentity,
  c: Combo,
  after: { created_at: string; id: string } | null
): Promise<Row[]> {
  const label =
    c.item || c.variant || c.category || c.content || c.state || c.query
  const args = {
    ...(c.item ? { p_item: c.item } : {}),
    ...(c.variant ? { p_variant: c.variant } : {}),
    ...(c.category ? { p_category: c.category } : {}),
    ...(c.content ? { p_content_type: c.content } : {}),
    ...(c.state ? { p_label_state: c.state } : {}),
    ...(c.query ? { p_query: c.query } : {}),
  }
  const base = label
    ? applyFeed(
        user.client
          .rpc("library_assets", args)
          .select(SEL)
          .is("deleted_at", null),
        c,
        after
      )
    : applyFeed(
        user.client.from("media_assets").select(SEL).is("deleted_at", null),
        c,
        after
      )
  const { data, error } = await base
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE)
  if (error) throw new Error(`old: ${error.message}`)
  return data ?? []
}

async function newPage(
  user: TestIdentity,
  c: Combo,
  after: { created_at: string; id: string } | null,
  cap: number | null
): Promise<Row[]> {
  const { data, error } = await user.client
    .rpc("library_page", {
      ...(c.venue ? { p_venue: c.venue } : {}),
      ...(c.staff ? { p_staff: c.staff } : {}),
      ...(c.type ? { p_type: c.type } : {}),
      ...(c.from ? { p_from: c.from } : {}),
      ...(c.to ? { p_to: c.to } : {}),
      ...(c.item ? { p_item: c.item } : {}),
      ...(c.variant ? { p_variant: c.variant } : {}),
      ...(c.category ? { p_category: c.category } : {}),
      ...(c.content ? { p_content_type: c.content } : {}),
      ...(c.state ? { p_label_state: c.state } : {}),
      ...(c.query ? { p_query: c.query } : {}),
      ...(after
        ? { p_after_created_at: after.created_at, p_after_id: after.id }
        : {}),
      p_limit: PAGE,
      ...(cap === null ? {} : { p_candidate_cap: cap }),
    })
    .select(SEL)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE)
  if (error) throw new Error(`new: ${error.message}`)
  return data ?? []
}

/** Walks the whole feed with both implementations; returns every id in order. */
async function walk(
  user: TestIdentity,
  c: Combo,
  cap: number | null
): Promise<string[]> {
  const all: string[] = []
  let after: { created_at: string; id: string } | null = null
  for (let i = 0; i < 60; i++) {
    const was: Row[] = await oldPage(user, c, after)
    const now: Row[] = await newPage(user, c, after, cap)
    expect(
      now.map((r) => [r.id, r.created_at]),
      `page ${i} of ${JSON.stringify(c)} cap ${cap}`
    ).toEqual(was.map((r) => [r.id, r.created_at]))
    all.push(...now.map((r) => r.id))
    if (now.length < PAGE) break
    const last: Row = now[now.length - 1]!
    after = { created_at: last.created_at, id: last.id }
  }
  expect(new Set(all).size, "no asset twice").toBe(all.length)
  return all
}

describe("library_page against library_assets and the table feed", () => {
  let venue: string
  let admin: TestIdentity
  let staff1: TestIdentity
  let staff2: TestIdentity
  let version: string
  let d: Record<string, CatalogueRow>
  const assets: string[] = []
  let notReady: string
  let tombstoned: string

  beforeAll(async () => {
    venue = (await createVenue(service, "lp-a")).id
    admin = await createIdentity(service, { label: "lp-admin", role: "admin" })
    staff1 = await createIdentity(service, {
      label: "lp-staff-1",
      role: "staff",
      venueId: venue,
    })
    staff2 = await createIdentity(service, {
      label: "lp-staff-2",
      role: "staff",
      venueId: venue,
    })
    version = await publishMenu(
      admin,
      venue,
      menu("TEST library page", [
        section("curries", "Curries", [
          item("curries--tikka", "Tikka 100%_real", {
            aliases: ["Chicken tikka", "CTM"],
            variants: ["Chicken", "Paneer"],
          }),
          item("curries--korma", "Korma", { aliases: ["Mild korma"] }),
        ]),
        section("starters", "Starters", [
          item("starters--bhaji", "Onion Bhaji"),
          item("starters--samosa", "Samosa"),
        ]),
        section("drinks", "Drinks", [item("drinks--lassi", "Lassi")], "drinks"),
      ])
    )
    d = (await readDocument(service, version)).byKey
    const one = (key: string, variant?: number) => ({
      itemId: d[key]!.itemId,
      variantId:
        variant === undefined ? null : d[key]!.variants[variant]!.variantId,
    })
    const people = [staff1, staff2]
    for (let i = 0; i < 48; i++) {
      const owner = people[i % 2]!
      const asset = await reserveReady(
        service,
        owner,
        i % 5 === 0 ? "video" : "image"
      )
      assets.push(asset.id)
      const args = (() => {
        switch (i % 8) {
          case 1:
            return { types: ["dish"] }
          case 2:
            return {
              items: [one("curries--tikka", 0)],
              types: ["dish", "plating"],
              note: "Friday SPECIAL",
            }
          case 3:
            return {
              items: [one("curries--tikka", 1), one("starters--samosa")],
              types: ["kitchen"],
            }
          case 4:
            return { items: [one("curries--korma")], missing: "Staff curry" }
          case 5:
            return {
              items: [one("starters--bhaji")],
              note: "50%_off a\\b 'quoted'",
            }
          case 6:
            return { items: [one("drinks--lassi")], types: ["drinks", "team"] }
          case 7:
            return { note: "just a note" }
          default:
            return null
        }
      })()
      if (args) {
        await saveOk(owner, {
          asset: asset.id,
          revision: 0,
          catalogue: version,
          ...args,
        })
      }
    }
    // Three assets share each timestamp (ties), 36 hours apart groups.
    setCreatedAt(
      assets.map((id, i) => [
        id,
        new Date(
          Date.UTC(2026, 8, 1, 12) +
            Math.floor(i / 3) * 3_600_000 +
            123_456 / 1000
        ).toISOString(),
      ])
    )
    notReady = (await reserve(staff1, "image")).id
    const gone = await reserveReady(service, staff1, "image")
    tombstoned = gone.id
    const { error } = await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", gone.id)
    if (error) throw error
  }, 300_000)

  const combos = (): Combo[] => {
    const tikka = d["curries--tikka"]!
    const base = { venue }
    return [
      {},
      { type: "video" },
      { type: "image" },
      { staff: staff1.id },
      {
        from: "2026-09-01T14:00:00.000Z",
        to: "2026-09-02T02:00:00.000Z",
      },
      { item: tikka.itemId },
      { item: d["starters--bhaji"]!.itemId },
      { variant: tikka.variants[1]!.variantId },
      { item: tikka.itemId, variant: tikka.variants[0]!.variantId },
      {
        item: d["curries--korma"]!.itemId,
        variant: tikka.variants[0]!.variantId,
      },
      { category: "curries" },
      { category: "drinks" },
      { category: "nothing" },
      { content: "dish" },
      { content: "team" },
      { content: "event" },
      { content: "bogus" },
      { state: "labelled" },
      { state: "unlabelled" },
      { state: "bogus" },
      { query: "friday" },
      { query: "KORMA" },
      { query: "chicken tikka" },
      { query: "ctm" },
      { query: "mild" },
      { query: "staff curry" },
      { query: "100%_r" },
      { query: "%" },
      { query: "_" },
      { query: "\\" },
      { query: "'; drop table public.media_assets; --" },
      { query: '"' },
      { query: "Chef's" },
      { query: "50%_off a\\b 'quoted'" },
      { query: "zz" },
      { query: "q" },
      { query: "no such text anywhere" },
      { category: "curries", content: "kitchen" },
      { category: "curries", state: "labelled", query: "korma" },
      { item: tikka.itemId, type: "video" },
      { category: "curries", staff: staff2.id },
      { state: "unlabelled", type: "image", staff: staff1.id },
      { query: "tikka", from: "2026-09-01T14:00:00.000Z" },
      { content: "dish", to: "2026-09-01T20:00:00.000Z" },
    ].map((c) => ({ ...base, ...c }) as Combo)
  }

  it("gives the same pages as the references for admin, on both strategies", async () => {
    for (const c of combos()) {
      const walked: Record<string, string[]> = {}
      // 0 walks the feed, 20000 reads the matching ids first, 2 finds more
      // candidates than the cap and falls back to the walk, null is the default.
      for (const cap of [0, 2, 20000, null]) {
        walked[String(cap)] = await walk(admin, c, cap)
      }
      expect(walked["2"]).toEqual(walked["0"])
      expect(walked["20000"]).toEqual(walked["0"])
      expect(walked.null).toEqual(walked["0"])
    }
  }, 600_000)

  it("gives the same pages as the references for staff (their own assets only)", async () => {
    for (const user of [staff1, staff2]) {
      for (const c of combos()) {
        for (const cap of [0, 20000]) await walk(user, c, cap)
      }
    }
  }, 600_000)

  it("excludes assets that are not ready or are deleted, and covers the fixtures", async () => {
    const all = await walk(admin, { venue }, null)
    expect(all).not.toContain(notReady)
    expect(all).not.toContain(tombstoned)
    expect(all).toHaveLength(assets.length)
    // The fixtures reach every strategy: item, text, category, content type.
    expect(
      (await walk(admin, { venue, category: "curries" }, 20000)).length
    ).toBeGreaterThan(0)
    expect(
      (await walk(admin, { venue, state: "unlabelled" }, null)).length
    ).toBeGreaterThan(0)
  }, 120_000)

  it("clamps the page size and keeps ties on created_at in strict id order", async () => {
    const { data, error } = await admin.client
      .rpc("library_page", { p_venue: venue, p_limit: 1000 })
      .select("id, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
    if (error) throw error
    expect(data).toHaveLength(25)
    for (let i = 1; i < data.length; i++) {
      const [p, n] = [data[i - 1]!, data[i]!]
      expect(
        p.created_at > n.created_at ||
          (p.created_at === n.created_at && p.id > n.id)
      ).toBe(true)
    }
  })

  it("is not callable anonymously, and RLS still decides which assets staff see", async () => {
    const anon = await anonClient()
      .rpc("library_page", { p_venue: venue })
      .select("id")
    expect(anon.error, "anon has no EXECUTE").not.toBeNull()
    const { data: staffRows } = await staff1.client
      .rpc("library_page", { p_venue: venue, p_limit: 25 })
      .select("id, uploader_id")
    expect(staffRows!.length).toBeGreaterThan(0)
    expect(
      staffRows!.every((r) => r.uploader_id === staff1.id),
      "staff see only their own assets through library_page"
    ).toBe(true)
  })
})

describe("library label filter options with more than 1,000 labelled items", () => {
  it("returns every labelled item and variant, as the table reads did", async () => {
    const venue = (await createVenue(service, "lp-opts")).id
    const admin = await createIdentity(service, {
      label: "lpo-admin",
      role: "admin",
    })
    const staff = await createIdentity(service, {
      label: "lpo-staff",
      role: "staff",
      venueId: venue,
    })
    const N = 1100
    const sections = Array.from({ length: 11 }, (_, s) =>
      section(
        `sec-${s}`,
        `Section ${s}`,
        Array.from({ length: N / 11 }, (_, i) =>
          item(`s${s}--i${i}`, `Dish ${s}-${i}`, {
            variants: i % 50 === 0 ? ["Small", "Large"] : [],
          })
        )
      )
    )
    const v1 = await publishMenu(admin, venue, menu("TEST big menu", sections))
    const doc = await readDocument(service, v1)
    const keys = Object.keys(doc.byKey)
    expect(keys).toHaveLength(N)
    const label = async (rows: CatalogueRow[], catalogue: string) => {
      for (let i = 0; i < rows.length; i += 20) {
        const asset = await reserveReady(service, staff, "image")
        await saveOk(staff, {
          asset: asset.id,
          revision: 0,
          catalogue,
          items: rows.slice(i, i + 20).map((r, j) => ({
            itemId: r.itemId,
            variantId: i + j === 0 ? r.variants[0]!.variantId : null,
          })),
        })
      }
    }
    await label(
      keys.map((k) => doc.byKey[k]!),
      v1
    )
    // A later label with a newer snapshot name for three items.
    const renamed = {
      ...doc,
      sections: doc.sections.map((s, si) =>
        si === 0
          ? {
              ...s,
              items: s.items.map((it, i) =>
                i < 3 ? { ...it, name: `${it.name} renamed` } : it
              ),
            }
          : s
      ),
    }
    const v2 = await publishMenu(admin, venue, renamed, v1)
    const doc2 = await readDocument(service, v2)
    await label(
      doc2.sections[0]!.items.slice(0, 3).map(
        (it) => doc2.byKey[it.sourceKey]!
      ),
      v2
    )

    // The reads the app used before: an inner embed under every item/variant.
    const readAll = async <T>(
      read: (
        from: number,
        to: number
      ) => PromiseLike<{ data: T[] | null; error: unknown }>
    ) => {
      const rows: T[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await read(from, from + 999)
        if (error) throw error
        rows.push(...(data ?? []))
        if (!data || data.length < 1000) return rows
      }
    }
    const oldItems = await readAll((from, to) =>
      admin.client
        .from("menu_items")
        .select(
          "id, labels:media_label_items!inner(item_name, section_name, added_at)"
        )
        .eq("venue_id", venue)
        .order("added_at", { referencedTable: "labels", ascending: false })
        .limit(1, { referencedTable: "labels" })
        .order("id")
        .range(from, to)
    )
    const oldVariants = await readAll((from, to) =>
      admin.client
        .from("menu_variants")
        .select(
          "id, item_id, labels:media_label_items!inner(variant_name, added_at)"
        )
        .eq("venue_id", venue)
        .order("added_at", { referencedTable: "labels", ascending: false })
        .limit(1, { referencedTable: "labels" })
        .order("id")
        .range(from, to)
    )
    expect(oldItems.length).toBe(N)

    const { data: newItems, error: e1 } = await admin.client.rpc(
      "library_labelled_items",
      { p_venue_id: venue }
    )
    const { data: newVariants, error: e2 } = await admin.client.rpc(
      "library_labelled_variants",
      { p_venue_id: venue }
    )
    if (e1) throw e1
    if (e2) throw e2
    const items = newItems as {
      item_id: string
      item_name: string
      section_name: string | null
    }[]
    const variants = newVariants as {
      variant_id: string
      item_id: string
      variant_name: string
    }[]
    expect(items).toHaveLength(N)
    expect(items.map((i) => [i.item_id, i.item_name, i.section_name])).toEqual(
      oldItems.map((i) => [
        i.id,
        i.labels[0]!.item_name,
        i.labels[0]!.section_name,
      ])
    )
    expect(
      variants.map((v) => [v.variant_id, v.item_id, v.variant_name])
    ).toEqual(
      oldVariants.map((v) => [v.id, v.item_id, v.labels[0]!.variant_name])
    )
    expect(items.some((i) => i.item_name.endsWith("renamed"))).toBe(true)

    // The app function, end to end: all 1,100 items are on the active menu.
    const options = await libraryLabelFilterOptions(
      await actorFor(admin),
      venue
    )
    expect(options.items).toHaveLength(N)
    expect(options.categories).toHaveLength(11)

    // Staff may not read the admin-only filter options through the app function,
    // and RLS limits the RPC to their own labels.
    const { data: own } = await staff.client.rpc("library_labelled_items", {
      p_venue_id: venue,
    })
    expect((own as unknown[]).length).toBeLessThanOrEqual(N)
  }, 600_000)
})
