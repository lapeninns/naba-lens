// getLabellingCatalogue used to embed menu_items(archived_at) in every entry
// read and now reads the venue's archived item ids separately. This compares
// the current function with that previous read (reproduced below, same
// columns, paging and filter) for admin, staff and a transferred staff member:
// the results must be identical.
import { beforeAll, describe, expect, it } from "vitest"

import { getLabellingCatalogue } from "../../lib/server/labels"
import type { MediaActor } from "../../lib/server/media/types"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

const service = serviceClient()
let venue: string
let other: string
let admin: TestIdentity
let staff: TestIdentity
let mover: TestIdentity
let outsider: TestIdentity
let rows: Record<string, CatalogueRow>
let otherRows: Record<string, CatalogueRow>
let activeVersion: string

type Shape = {
  slug: string
  items: { itemId: string; name: string; variants: string[] }[]
}[]

/** The previous read: archived state embedded in each entry. */
async function previous(
  who: TestIdentity,
  venueId: string
): Promise<{ shape: Shape; hiddenItems: number }> {
  const version = await who.client
    .from("menu_versions")
    .select("id")
    .eq("venue_id", venueId)
    .eq("status", "active")
    .maybeSingle()
  if (!version.data) throw new Error("no active version")
  const sections = await who.client
    .from("menu_sections")
    .select("id, slug, position")
    .eq("version_id", version.data.id)
    .order("position")
  const entries: {
    section_id: string
    item_id: string
    name: string
    position: number
    item: { archived_at: string | null } | null
    menu_entry_variants: { name: string; position: number }[]
  }[] = []
  for (let from = 0; ; from += 1000) {
    const page = await who.client
      .from("menu_entries")
      .select(
        "section_id, item_id, name, description, aliases, position, item:menu_items(archived_at), menu_entry_variants(variant_id, name, position)"
      )
      .eq("version_id", version.data.id)
      .order("section_id")
      .order("position")
      .order("item_id")
      .range(from, from + 999)
    if (page.error) throw page.error
    entries.push(...(page.data as unknown as typeof entries))
    if (page.data.length < 1000) break
  }
  return {
    // An entry whose item the caller's RLS hides reads as "not archived".
    hiddenItems: entries.filter((e) => e.item === null).length,
    shape: (sections.data ?? [])
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        slug: s.slug,
        items: entries
          .filter((e) => e.section_id === s.id && !e.item?.archived_at)
          .sort((a, b) => a.position - b.position)
          .map((e) => ({
            itemId: e.item_id,
            name: e.name,
            variants: [...e.menu_entry_variants]
              .sort((a, b) => a.position - b.position)
              .map((v) => v.name),
          })),
      })),
  }
}

async function current(actor: MediaActor, venueId: string): Promise<Shape> {
  const found = await getLabellingCatalogue(actor, venueId)
  if (!found.ok || found.catalogue.status !== "active")
    throw new Error("no catalogue")
  return found.catalogue.sections.map((s) => ({
    slug: s.slug,
    items: s.items.map((i) => ({
      itemId: i.itemId,
      name: i.name,
      variants: i.variants.map((v) => v.name),
    })),
  }))
}

const archive = async (itemId: string) => {
  const { error } = await admin.client.rpc("set_menu_item_archived", {
    p_item_id: itemId,
    p_archived: true,
  })
  if (error) throw error
}

beforeAll(async () => {
  venue = (await createVenue(service, "cat-eq")).id
  other = (await createVenue(service, "cat-eq-other")).id
  admin = await createIdentity(service, { label: "cat-eq-admin", role: "admin" })
  staff = await createIdentity(service, {
    label: "cat-eq-staff",
    role: "staff",
    venueId: venue,
  })
  mover = await createIdentity(service, {
    label: "cat-eq-mover",
    role: "staff",
    venueId: venue,
  })
  outsider = await createIdentity(service, {
    label: "cat-eq-outsider",
    role: "staff",
    venueId: other,
  })

  const v1 = await publishMenu(
    admin,
    venue,
    menu("TEST catalogue v1", [
      section("mains", "Mains", [
        item("mains--a1", "A1", { variants: ["Small", "Large"] }),
        item("mains--a2", "A2"),
        item("mains--a3", "A3"),
      ]),
      section("sides", "Sides", [item("sides--a4", "A4"), item("sides--a5", "A5")]),
    ])
  )
  const first = (await readDocument(service, v1)).byKey
  // v2 (active) keeps a1-a4, drops a5 and adds a new item; a5 now lives only in
  // the retired v1.
  activeVersion = await publishMenu(
    admin,
    venue,
    {
      title: "TEST catalogue v2",
      sections: [
        {
          slug: "mains",
          name: "Mains",
          kind: "food",
          items: ["mains--a1", "mains--a2", "mains--a3"].map((k) =>
            carry(first[k])
          ),
        },
        {
          slug: "sides",
          name: "Sides",
          kind: "food",
          items: [
            carry(first["sides--a4"]),
            item("sides--n1", "N1", { variants: ["Half"] }),
          ],
        },
      ],
    },
    v1
  )
  rows = (await readDocument(service, activeVersion)).byKey

  const otherVersion = await publishMenu(
    admin,
    other,
    menu("TEST catalogue other", [
      section("mains", "Mains", [item("mains--z1", "Z1"), item("mains--z2", "Z2")]),
    ])
  )
  otherRows = (await readDocument(service, otherVersion)).byKey

  await reserveReady(service, mover) // an own asset at `venue`...
  const moved = await service
    .from("profiles")
    .update({ venue_id: other })
    .eq("id", mover.id)
  if (moved.error) throw moved.error // ...so it still reads `venue` after the move

  await archive(rows["mains--a2"].itemId) // archived in the active version
  await archive(first["sides--a5"].itemId) // archived, only in a retired version
  await archive(otherRows["mains--z1"].itemId) // another venue's archived item
})

/** An item of an earlier version, with its ids carried into the next one. */
function carry(row: CatalogueRow) {
  return item(row.sourceKey, row.name, {
    itemId: row.itemId,
    variants: row.variants.map((v) => ({
      variantId: v.variantId,
      name: v.name,
    })),
  })
}

describe("getLabellingCatalogue against its previous read", () => {
  it("is identical for admin", async () => {
    const before = await previous(admin, venue)
    const after = await current(await actorFor(admin), venue)
    expect(after).toEqual(before.shape)
    expect(after.flatMap((s) => s.items.map((i) => i.name))).toEqual([
      "A1",
      "A3",
      "A4",
      "N1",
    ])
    expect(await current(await actorFor(admin), other)).toEqual(
      (await previous(admin, other)).shape
    )
  })

  it("is identical for staff of the venue", async () => {
    const before = await previous(staff, venue)
    expect(await current(await actorFor(staff), venue)).toEqual(before.shape)
  })

  it("is identical for a transferred staff member reading the old venue", async () => {
    const before = await previous(mover, venue)
    expect(await current(await actorFor(mover), venue)).toEqual(before.shape)
  })

  it("never hides an item of the active version from staff, so archived state is never missed", async () => {
    // The staff policy on menu_items admits every item of an active version of
    // a venue the caller may label, so the old embed never came back null.
    for (const who of [staff, mover]) {
      expect((await previous(who, venue)).hiddenItems).toBe(0)
    }
  })

  it("does not leak another venue's archived items or its catalogue", async () => {
    const outsiderActor = await actorFor(outsider)
    expect((await getLabellingCatalogue(outsiderActor, venue)).ok).toBe(false)
    expect(await current(outsiderActor, other)).toEqual(
      (await previous(outsider, other)).shape
    )
    expect(
      (await current(outsiderActor, other)).flatMap((s) =>
        s.items.map((i) => i.name)
      )
    ).toEqual(["Z2"])
  })
})
