// Drift guard for private.library_candidate_ids (the SECURITY DEFINER lookup
// behind library_page's label filters). It repeats the admin label rule of
// private.can_read_asset_labels without calling it, so these tests compare what
// it admits with the label, menu-entry and suggestion rows an admin can read
// through RLS, over fixtures that include deleted, not-ready, other-venue and
// inactive-admin cases. The function is not in an exposed schema, so it is
// called with psql under the `authenticated` role and the person's JWT claims.
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  createDraft,
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
const T = randomUUID().slice(0, 8)
const slug = `drift-${T}`
const CAP = 20000

function dbUrl() {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  return url
}

const psql = (input: string) =>
  execFileSync("psql", [dbUrl(), "-v", "ON_ERROR_STOP=1", "-qAt"], {
    encoding: "utf8",
    input,
  })

const lit = (value: string | null) =>
  value === null ? "null" : `'${value.replace(/'/g, "''")}'`

/** Ids the helper admits for this caller; null when it answers null. */
function candidates(
  person: string | null,
  kind: string,
  args: { item?: string; variant?: string; text?: string } = {}
): string[] | null {
  const claims = person
    ? JSON.stringify({
        sub: person,
        role: "authenticated",
        aud: "authenticated",
      })
    : JSON.stringify({ role: "authenticated", aud: "authenticated" })
  const out = psql(`begin;
set local role authenticated;
select set_config('request.jwt.claims', ${lit(claims)}, true) \\gset
select coalesce(array_to_string(private.library_candidate_ids(${lit(kind)}, ${lit(args.item ?? null)}::uuid, ${lit(args.variant ?? null)}::uuid, ${lit(args.text ?? null)}, ${CAP}), ','), '<null>');
rollback;
`)
  const line = out.trim().split("\n").pop()!.trim()
  if (line === "<null>") return null
  // The union of several lookups may name an asset twice; `= any()` does not mind.
  return line === "" ? [] : [...new Set(line.split(","))].sort()
}

const uniq = (ids: (string | null)[]) =>
  [...new Set(ids.filter((id): id is string => !!id))].sort()

describe("library_candidate_ids against what admin RLS lets through", () => {
  let venueA: string
  let venueB: string
  let admin: TestIdentity
  let inactiveAdmin: TestIdentity
  let staffA: TestIdentity
  let staffB: TestIdentity
  let a: Record<string, CatalogueRow>
  let b: Record<string, CatalogueRow>
  let archivedItem: string
  let draftItem: string
  const asset = {} as Record<
    "ready" | "otherVenue" | "deleted" | "notReady" | "suggested" | "noteOnly",
    string
  >

  beforeAll(async () => {
    venueA = (await createVenue(service, "drift-a")).id
    venueB = (await createVenue(service, "drift-b")).id
    admin = await createIdentity(service, {
      label: "drift-admin",
      role: "admin",
    })
    inactiveAdmin = await createIdentity(service, {
      label: "drift-inactive-admin",
      role: "admin",
    })
    staffA = await createIdentity(service, {
      label: "drift-staff-a",
      role: "staff",
      venueId: venueA,
    })
    staffB = await createIdentity(service, {
      label: "drift-staff-b",
      role: "staff",
      venueId: venueB,
    })
    const versionA = await publishMenu(
      admin,
      venueA,
      menu("TEST drift A", [
        section(slug, "Drift section", [
          item(`${slug}--tikka`, `Tikka ${T}old`, {
            aliases: [`Alias ${T}`],
            variants: ["Chicken", "Paneer"],
          }),
        ]),
      ])
    )
    const versionB = await publishMenu(
      admin,
      venueB,
      menu("TEST drift B", [
        section(slug, "Drift section", [item(`${slug}--korma`, `Korma ${T}`)]),
      ])
    )
    a = (await readDocument(service, versionA)).byKey
    b = (await readDocument(service, versionB)).byKey
    const tikka = a[`${slug}--tikka`]!

    const label = async (
      owner: TestIdentity,
      version: string,
      args: Parameters<typeof saveOk>[1] extends infer S
        ? Omit<Exclude<S, undefined>, "asset" | "revision" | "catalogue">
        : never
    ) => {
      const created = await reserveReady(service, owner, "image")
      await saveOk(owner, {
        asset: created.id,
        revision: 0,
        catalogue: version,
        ...args,
      })
      return created.id
    }
    asset.ready = await label(staffA, versionA, {
      items: [
        { itemId: tikka.itemId, variantId: tikka.variants[0]!.variantId },
      ],
      types: ["dish"],
      note: `note ${T}`,
    })
    asset.otherVenue = await label(staffB, versionB, {
      items: [{ itemId: b[`${slug}--korma`]!.itemId, variantId: null }],
      note: `note ${T}`,
    })
    asset.deleted = await label(staffA, versionA, {
      items: [{ itemId: tikka.itemId, variantId: null }],
      types: ["dish"],
      note: `note ${T}`,
    })
    asset.notReady = await label(staffA, versionA, {
      items: [{ itemId: tikka.itemId, variantId: null }],
      types: ["dish"],
      note: `note ${T}`,
    })
    asset.suggested = await label(staffA, versionA, {
      missing: `Staff ${T} curry`,
    })
    asset.noteOnly = await label(staffA, versionA, { note: `only ${T}` })

    // Later versions: v2 (active) renames the item and adds one that is then
    // archived, v1 is retired, v3 is a draft with an item only it has.
    const doc1 = await readDocument(service, versionA)
    const sec1 = doc1.sections[0]!
    const doc2 = {
      title: "TEST drift A v2",
      sections: [
        {
          ...sec1,
          items: [
            ...sec1.items.map((it) => ({ ...it, name: `Tikka ${T}new` })),
            item(`${slug}--archived`, `Archived ${T}arc`),
          ],
        },
      ],
    }
    const versionA2 = await publishMenu(admin, venueA, doc2, versionA)
    const doc2Read = await readDocument(service, versionA2)
    archivedItem = doc2Read.byKey[`${slug}--archived`]!.itemId
    const archived = await admin.client.rpc("set_menu_item_archived", {
      p_item_id: archivedItem,
      p_archived: true,
    })
    if (archived.error) throw archived.error
    draftItem = (
      await readDocument(
        service,
        await createDraft(
          admin,
          venueA,
          {
            title: "TEST drift A draft",
            sections: [
              {
                ...doc2Read.sections[0]!,
                items: [
                  ...doc2Read.sections[0]!.items,
                  item(`${slug}--draft`, `Draft ${T}drf`),
                ],
              },
            ],
          },
          versionA2
        )
      )
    ).byKey[`${slug}--draft`]!.itemId

    const { error } = await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", asset.deleted)
    if (error) throw error
    psql(
      `set session_replication_role = replica; update public.media_assets set upload_state = 'processing' where id = ${lit(asset.notReady)}`
    )
    const off = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", inactiveAdmin.id)
    if (off.error) throw off.error
  }, 300_000)

  const mine = () => new Set(Object.values(asset))
  const mineOnly = (ids: string[]) => ids.filter((id) => mine().has(id))

  async function visibleAssets(ids: string[]) {
    if (!ids.length) return []
    const { data, error } = await admin.client
      .from("media_assets")
      .select("id")
      .in("id", ids)
    if (error) throw error
    return data.map((r) => r.id)
  }

  const itemRows = async (
    filter: (q: ReturnType<typeof base>) => PromiseLike<{
      data: { asset_id: string }[] | null
      error: unknown
    }>
  ) => {
    const { data, error } = await filter(base())
    if (error) throw error
    return data!.map((r) => r.asset_id)
  }
  const base = () => admin.client.from("media_label_items").select("asset_id")

  it("admits exactly the readable label rows for an item and a variant", async () => {
    const tikka = a[`${slug}--tikka`]!
    const byItem = await itemRows((q) => q.eq("item_id", tikka.itemId))
    expect(candidates(admin.id, "item", { item: tikka.itemId })).toEqual(
      uniq(byItem)
    )
    const byVariant = await itemRows((q) =>
      q.eq("variant_id", tikka.variants[0]!.variantId)
    )
    expect(
      candidates(admin.id, "item", { variant: tikka.variants[0]!.variantId })
    ).toEqual(uniq(byVariant))
    // The deleted and not-ready assets carry the item but are not admitted.
    expect(byItem).toContain(asset.ready)
    expect(byItem).not.toContain(asset.deleted)
    expect(byItem).not.toContain(asset.notReady)
  })

  it("admits exactly the readable label rows for a category, across venues", async () => {
    const direct = await itemRows((q) => q.eq("section_slug", slug))
    const { data: sections, error } = await admin.client
      .from("menu_sections")
      .select("venue_id, menu_versions!inner(status), menu_entries(item_id)")
      .eq("slug", slug)
      .eq("menu_versions.status", "active")
    if (error) throw error
    const viaMenu: string[] = []
    for (const s of sections) {
      const ids = s.menu_entries.map((e) => e.item_id)
      const rows = await itemRows((q) =>
        q.in("item_id", ids).eq("venue_id", s.venue_id)
      )
      viaMenu.push(...rows)
    }
    expect(candidates(admin.id, "category", { text: slug })).toEqual(
      uniq([...direct, ...viaMenu])
    )
    expect(direct).toContain(asset.otherVenue)
  })

  it("admits exactly the readable matches of a text search", async () => {
    const pattern = `%${T}%`
    // ILIKE is not leakproof, so under RLS these reads check every label row
    // they may touch first; naming this run's assets keeps them to those rows
    // on a stack that also holds a large library.
    const mineIds = [...mine()]
    const notes = await admin.client
      .from("media_labels")
      .select("asset_id")
      .in("asset_id", mineIds)
      .ilike("note", pattern)
    const names = await admin.client
      .from("media_label_items")
      .select("asset_id")
      .in("asset_id", mineIds)
      .or(
        `item_name.ilike.${pattern},variant_name.ilike.${pattern},section_name.ilike.${pattern}`
      )
    const entries = await admin.client
      .from("menu_entries")
      .select("item_id, name, aliases")
      .in("venue_id", [venueA, venueB])
    const suggestions = await admin.client
      .from("menu_item_suggestions")
      .select("asset_id")
      .eq("status", "open")
      .in("asset_id", mineIds)
      .ilike("suggested_name", pattern)
    for (const r of [notes, names, entries, suggestions])
      if (r.error) throw r.error
    const entryItems = entries
      .data!.filter(
        (e) =>
          e.name.toLowerCase().includes(T) ||
          e.aliases.some((x) => x.toLowerCase().includes(T))
      )
      .map((e) => e.item_id)
    const viaEntries = await itemRows((q) => q.in("item_id", entryItems))
    // A suggestion is admin-readable whatever the asset's state; the helper
    // admits only assets the admin can see, as the filter result does.
    const suggested = await visibleAssets(
      uniq(suggestions.data!.map((r) => r.asset_id))
    )
    const expected = uniq([
      ...notes.data!.map((r) => r.asset_id),
      ...names.data!.map((r) => r.asset_id),
      ...viaEntries,
      ...suggested,
    ])
    expect(mineOnly(candidates(admin.id, "query", { text: pattern })!)).toEqual(
      mineOnly(expected)
    )
    const ours = mineOnly(expected)
    expect(ours).toEqual(
      expect.arrayContaining([
        asset.ready,
        asset.otherVenue,
        asset.suggested,
        asset.noteOnly,
      ])
    )
    expect(ours).not.toContain(asset.deleted)
    expect(ours).not.toContain(asset.notReady)
    // Alias and variant-free matches reach assets through the menu entry.
    expect(candidates(admin.id, "query", { text: `%alias ${T}%` })).toEqual(
      uniq(await itemRows((q) => q.eq("item_id", a[`${slug}--tikka`]!.itemId)))
    )
  })

  it("admits the readable labelled and content-type rows (when the stack is small enough to list them)", async () => {
    const labelled = await admin.client
      .from("media_labels")
      .select("asset_id")
      .eq("has_labels", true)
      .limit(CAP)
    const dish = await admin.client
      .from("media_labels")
      .select("asset_id")
      .contains("content_types", ["dish"])
      .limit(CAP)
    if (labelled.error) throw labelled.error
    if (dish.error) throw dish.error
    for (const [kind, rows, text] of [
      ["labelled", labelled.data, undefined],
      ["content", dish.data, "dish"],
    ] as const) {
      const got = candidates(admin.id, kind, { text })
      // PostgREST caps a response at max_rows, so the comparison is exact
      // only on a stack with fewer labelled assets than that (CI's).
      if (rows.length >= 1000) continue
      expect(got, kind).toEqual(uniq(rows.map((r) => r.asset_id)))
      expect(got).toContain(asset.ready)
      expect(got).not.toContain(asset.deleted)
      expect(got).not.toContain(asset.notReady)
    }
  })

  it("admits exactly the item ids an admin can read through menu RLS, for query and category entries", async () => {
    const tikka = a[`${slug}--tikka`]!
    const korma = b[`${slug}--korma`]!
    const readEntries = async () => {
      const { data, error } = await admin.client
        .from("menu_entries")
        .select("item_id, name, aliases, menu_versions!inner(status)")
        .in("venue_id", [venueA, venueB])
      if (error) throw error
      return data
    }
    const entries = await readEntries()
    const matching = (text: string) =>
      uniq(
        entries
          .filter(
            (e) =>
              e.name.toLowerCase().includes(text.toLowerCase()) ||
              e.aliases.some((x) =>
                x.toLowerCase().includes(text.toLowerCase())
              )
          )
          .map((e) => e.item_id)
      )
    // Entries of every version count for a text search, as in library_assets:
    // the retired name, the draft-only item, the archived item, another venue.
    for (const [text, expectedItems] of [
      [`${T}old`, [tikka.itemId]],
      [`${T}new`, [tikka.itemId]],
      [`${T}drf`, [draftItem]],
      [`${T}arc`, [archivedItem]],
      [`alias ${T}`, [tikka.itemId]],
      [`korma ${T}`, [korma.itemId]],
    ] as const) {
      const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      expect(
        candidates(admin.id, "query_items", { text: pattern }),
        `entries matching ${text}`
      ).toEqual(matching(text))
      expect(matching(text)).toEqual(uniq([...expectedItems]))
    }
    // Only active versions count for a category.
    const { data: sections, error } = await admin.client
      .from("menu_sections")
      .select("menu_versions!inner(status), menu_entries(item_id)")
      .eq("slug", slug)
      .eq("menu_versions.status", "active")
    if (error) throw error
    const inActive = uniq(
      sections.flatMap((s) => s.menu_entries.map((e) => e.item_id))
    )
    expect(candidates(admin.id, "category_items", { text: slug })).toEqual(
      inActive
    )
    expect(inActive).toEqual(uniq([tikka.itemId, archivedItem, korma.itemId]))
    expect(inActive).not.toContain(draftItem)
    expect(candidates(admin.id, "category_items", { text: "nothing" })).toEqual(
      []
    )
  })

  it("answers null to inactive admins and staff for the item-id kinds", () => {
    for (const who of [inactiveAdmin, staffA, staffB]) {
      expect(
        candidates(who.id, "query_items", { text: `%${T}%` }),
        "query_items"
      ).toBeNull()
      expect(
        candidates(who.id, "category_items", { text: slug }),
        "category_items"
      ).toBeNull()
    }
    expect(candidates(null, "query_items", { text: `%${T}%` })).toBeNull()
  })

  it("gives library_page the same rows as library_assets for these filters", async () => {
    for (const args of [
      { p_category: slug },
      { p_query: T },
      { p_query: `${T}old` },
      { p_query: `${T}drf` },
      { p_query: `alias ${T}` },
      { p_query: `${T}arc` },
    ]) {
      // Per venue: library_assets reads whole label tables, which is too slow
      // for the API timeout on a stack that holds a large library.
      for (const venue of [venueA, venueB]) {
        const ref = await admin.client
          .rpc("library_assets", args)
          .select("id, created_at")
          .eq("venue_id", venue)
          .eq("upload_state", "ready")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(100)
        if (ref.error) throw ref.error
        for (const cap of [0, 20000, 3000]) {
          const got = await admin.client
            .rpc("library_page", {
              ...args,
              p_venue: venue,
              p_candidate_cap: cap,
              p_limit: 25,
            })
            .select("id, created_at")
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(25)
          if (got.error) throw got.error
          expect(
            got.data.map((r) => r.id),
            `${JSON.stringify(args)} venue ${venue} cap ${cap}`
          ).toEqual(ref.data.slice(0, 25).map((r) => r.id))
        }
      }
    }
  })

  it("answers null for inactive admins, staff and signed-out callers, and admits nothing to them through RLS", async () => {
    const tikka = a[`${slug}--tikka`]!
    for (const who of [inactiveAdmin, staffA, staffB]) {
      expect(
        candidates(who.id, "item", { item: tikka.itemId }),
        "helper answers null"
      ).toBeNull()
    }
    expect(candidates(null, "item", { item: tikka.itemId })).toBeNull()
    const seen = await inactiveAdmin.client
      .from("media_label_items")
      .select("asset_id")
      .eq("item_id", tikka.itemId)
    expect(seen.data ?? []).toEqual([])
  })

  it("is not callable by the signed-out role or through the Data API", async () => {
    expect(() =>
      psql(`begin;
set local role anon;
select private.library_candidate_ids('labelled', null, null, null, 10);
rollback;
`)
    ).toThrow()
    const viaApi = await admin.client
      .schema("private" as "public")
      .rpc("library_candidate_ids" as never, {} as never)
    expect(viaApi.error, "private is not an exposed schema").not.toBeNull()
    const viaPublic = await admin.client.rpc(
      "library_candidate_ids" as never,
      { p_kind: "labelled", p_cap: 10 } as never
    )
    expect(viaPublic.error, "not in public either").not.toBeNull()
    const anon = await anonClient()
      .schema("private" as "public")
      .rpc("library_candidate_ids" as never, {} as never)
    expect(anon.error).not.toBeNull()
  })
})
