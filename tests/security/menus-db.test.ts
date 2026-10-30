// v0.3 catalogue database contract (docs/fanout/CONTRACT-v0.3-menus.md §3 + A1):
// venue separation, draft visibility, activation lifecycle, revision
// compare-and-set, identity rules, immutability and write privileges. Every
// assertion runs as a real signed-in identity; the service role only builds
// fixtures and reads persisted state back.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"
import {
  asJson,
  createDraft,
  expectDbError,
  item,
  menu,
  publishMenu,
  readDocument,
  section,
} from "./menus-fixtures"

const service = serviceClient()
let venueA: string
let venueB: string
let admin: TestIdentity
let staffA: TestIdentity
let staffB: TestIdentity
let inactiveAdmin: TestIdentity
let inactiveStaff: TestIdentity

beforeAll(async () => {
  venueA = (await createVenue(service, "menus-a")).id
  venueB = (await createVenue(service, "menus-b")).id
  admin = await createIdentity(service, { label: "menus-admin", role: "admin" })
  staffA = await createIdentity(service, {
    label: "menus-staff-a",
    role: "staff",
    venueId: venueA,
  })
  staffB = await createIdentity(service, {
    label: "menus-staff-b",
    role: "staff",
    venueId: venueB,
  })
  inactiveAdmin = await createIdentity(service, {
    label: "menus-inactive-admin",
    role: "admin",
    active: false,
  })
  inactiveStaff = await createIdentity(service, {
    label: "menus-inactive-staff",
    role: "staff",
    venueId: venueA,
    active: false,
  })
})

async function versionIds(user: TestIdentity, venueId: string) {
  const { data, error } = await user.client
    .from("menu_versions")
    .select("id")
    .eq("venue_id", venueId)
  if (error) throw error
  return data.map((r) => r.id)
}

async function countVisible(
  user: TestIdentity,
  table:
    | "menu_sections"
    | "menu_entries"
    | "menu_items"
    | "menu_variants"
    | "menu_events",
  column: string,
  value: string
) {
  const { data, error } = await user.client
    .from(table)
    .select("id")
    .eq(column, value)
  if (error) throw error
  return data.length
}

describe("venue separation and draft visibility", () => {
  let activeA: string
  let activeB: string
  let draftA: string

  beforeAll(async () => {
    activeA = await publishMenu(
      admin,
      venueA,
      menu("A main", [
        section("mains", "Mains", [
          item("mains--pie", "Pie", { variants: ["Beef", "Veg"] }),
        ]),
      ])
    )
    activeB = await publishMenu(
      admin,
      venueB,
      menu("B main", [section("mains", "Mains", [item("mains--pie", "Pie")])])
    )
    draftA = await createDraft(
      admin,
      venueA,
      menu("A draft", [
        section("drafts", "Draft only", [
          item("drafts--secret", "Secret", { variants: ["Large"] }),
        ]),
      ])
    )
  })

  it("staff read only their venue's active version", async () => {
    expect(await versionIds(staffA, venueA)).toEqual([activeA])
    expect(await versionIds(staffA, venueB)).toEqual([])
    expect(await versionIds(staffB, venueB)).toEqual([activeB])
    expect(await versionIds(staffB, venueA)).toEqual([])
    expect((await versionIds(admin, venueA)).sort()).toEqual(
      [activeA, draftA].sort()
    )
  })

  it("a draft's sections, entries, items and variants are invisible to staff", async () => {
    const draft = await readDocument(service, draftA)
    const secret = draft.byKey["drafts--secret"]!
    expect(
      await countVisible(staffA, "menu_sections", "version_id", draftA)
    ).toBe(0)
    expect(
      await countVisible(staffA, "menu_entries", "version_id", draftA)
    ).toBe(0)
    expect(await countVisible(staffA, "menu_items", "id", secret.itemId)).toBe(
      0
    )
    expect(
      await countVisible(
        staffA,
        "menu_variants",
        "id",
        secret.variants[0]!.variantId
      )
    ).toBe(0)
    expect(await countVisible(admin, "menu_items", "id", secret.itemId)).toBe(1)
    const { data } = await staffA.client
      .from("menu_entry_variants")
      .select("id")
      .eq("variant_id", secret.variants[0]!.variantId)
    expect(data).toEqual([])
  })

  it("staff read the active entries, items and variants of their venue only", async () => {
    const a = await readDocument(service, activeA)
    const b = await readDocument(service, activeB)
    const pieA = a.byKey["mains--pie"]!
    expect(
      await countVisible(staffA, "menu_entries", "version_id", activeA)
    ).toBe(1)
    expect(await countVisible(staffA, "menu_items", "id", pieA.itemId)).toBe(1)
    expect(
      await countVisible(staffA, "menu_variants", "item_id", pieA.itemId)
    ).toBe(2)
    expect(
      await countVisible(staffA, "menu_entries", "version_id", activeB)
    ).toBe(0)
    expect(
      await countVisible(
        staffA,
        "menu_items",
        "id",
        b.byKey["mains--pie"]!.itemId
      )
    ).toBe(0)
  })

  it("inactive users and staff see no catalogue rows or audit events", async () => {
    for (const user of [inactiveAdmin, inactiveStaff]) {
      expect(await versionIds(user, venueA)).toEqual([])
      expect(
        await countVisible(user, "menu_entries", "version_id", activeA)
      ).toBe(0)
    }
    expect(await countVisible(staffA, "menu_events", "venue_id", venueA)).toBe(
      0
    )
    expect(
      await countVisible(admin, "menu_events", "venue_id", venueA)
    ).toBeGreaterThan(0)
  })

  it("an item of another venue cannot enter a draft (menu_item_wrong_venue)", async () => {
    const b = await readDocument(service, activeB)
    const result = await admin.client.rpc("create_menu_draft", {
      p_venue_id: venueA,
      p_title: "Forged",
      p_source: asJson(null),
      p_document: asJson(
        menu("Forged", [
          section("mains", "Mains", [
            item("mains--pie", "Pie", {
              itemId: b.byKey["mains--pie"]!.itemId,
            }),
          ]),
        ])
      ),
    })
    expectDbError(result, "menu_item_wrong_venue", "22023")
    const candidate = await admin.client.rpc("create_menu_draft", {
      p_venue_id: venueA,
      p_title: "Forged review",
      p_source: asJson(null),
      p_document: asJson(
        menu("Forged review", [
          section("mains", "Mains", [
            item("mains--x", "X", {
              review: {
                candidates: [b.byKey["mains--pie"]!.itemId],
                reason: "same name",
              },
            }),
          ]),
        ])
      ),
    })
    expectDbError(candidate, "menu_item_wrong_venue", "22023")
  })
})

describe("activation lifecycle and revisions", () => {
  let venue: string

  beforeAll(async () => {
    venue = (await createVenue(service, "menus-life")).id
  })

  it("refuses an empty draft, a pending review and a stale revision; then activates and retires the previous", async () => {
    const empty = await createDraft(admin, venue, menu("Empty", []))
    expectDbError(
      await admin.client.rpc("activate_menu_version", {
        p_version_id: empty,
        p_expected_revision: 1,
      }),
      "menu_empty",
      "P0001"
    )

    const first = await publishMenu(
      admin,
      venue,
      menu("First", [section("mains", "Mains", [item("mains--a", "A")])])
    )
    const firstDoc = await readDocument(service, first)

    const draft = await createDraft(
      admin,
      venue,
      menu("Second", [
        section("mains", "Mains", [
          item("mains--a", "A", { itemId: firstDoc.byKey["mains--a"]!.itemId }),
          item("mains--a2", "A", {
            review: {
              candidates: [firstDoc.byKey["mains--a"]!.itemId],
              reason: "Same name as an existing item",
            },
          }),
        ]),
      ]),
      first
    )
    const { data: entries } = await admin.client
      .from("menu_entries")
      .select("source_key, needs_review, review_candidates, review_reason")
      .eq("version_id", draft)
      .eq("needs_review", true)
    expect(entries).toEqual([
      {
        source_key: "mains--a2",
        needs_review: true,
        review_candidates: [firstDoc.byKey["mains--a"]!.itemId],
        review_reason: "Same name as an existing item",
      },
    ])
    expectDbError(
      await admin.client.rpc("activate_menu_version", {
        p_version_id: draft,
        p_expected_revision: 1,
      }),
      "menu_review_pending",
      "P0001"
    )

    // Resolve the review by saving without it (revision 1 -> 2).
    const resolved = menu("Second", [
      section("mains", "Mains", [
        item("mains--a", "A", { itemId: firstDoc.byKey["mains--a"]!.itemId }),
        item("mains--a2", "A (large)"),
      ]),
    ])
    const saved = await admin.client.rpc("save_menu_draft", {
      p_version_id: draft,
      p_expected_revision: 1,
      p_document: asJson(resolved),
    })
    expect(saved.error).toBeNull()
    expect(saved.data).toBe(2)
    expectDbError(
      await admin.client.rpc("save_menu_draft", {
        p_version_id: draft,
        p_expected_revision: 1,
        p_document: asJson(resolved),
      }),
      "menu_version_conflict",
      "40001"
    )
    expectDbError(
      await admin.client.rpc("activate_menu_version", {
        p_version_id: draft,
        p_expected_revision: 1,
      }),
      "menu_version_conflict",
      "40001"
    )

    const ok = await admin.client.rpc("activate_menu_version", {
      p_version_id: draft,
      p_expected_revision: 2,
    })
    expect(ok.error).toBeNull()

    const { data: versions } = await service
      .from("menu_versions")
      .select("id, status, activated_by, reviewed_by, retired_by, retired_at")
      .eq("venue_id", venue)
    const byId = Object.fromEntries(versions!.map((v) => [v.id, v]))
    expect(byId[first]!.status).toBe("retired")
    expect(byId[first]!.retired_by).toBe(admin.id)
    expect(byId[draft]!).toMatchObject({
      status: "active",
      activated_by: admin.id,
      reviewed_by: admin.id,
    })

    // A non-draft version cannot be saved, activated again or discarded.
    expectDbError(
      await admin.client.rpc("save_menu_draft", {
        p_version_id: draft,
        p_expected_revision: 2,
        p_document: asJson(resolved),
      }),
      "menu_version_not_draft",
      "P0001"
    )
    expectDbError(
      await admin.client.rpc("discard_menu_draft", { p_version_id: draft }),
      "menu_version_not_draft"
    )
    expectDbError(
      await admin.client.rpc("retire_menu_version", { p_version_id: first }),
      "menu_version_not_active",
      "P0001"
    )

    // Retire: no active catalogue; staff then see none.
    const staff = await createIdentity(service, {
      label: "menus-life-staff",
      role: "staff",
      venueId: venue,
    })
    expect(await versionIds(staff, venue)).toEqual([draft])
    expect(
      (await admin.client.rpc("retire_menu_version", { p_version_id: draft }))
        .error
    ).toBeNull()
    expect(await versionIds(staff, venue)).toEqual([])

    // Discard a draft.
    expect(
      (await admin.client.rpc("discard_menu_draft", { p_version_id: empty }))
        .error
    ).toBeNull()
    const { data: discarded } = await service
      .from("menu_versions")
      .select("status")
      .eq("id", empty)
      .single()
    expect(discarded!.status).toBe("discarded")

    const { data: events } = await admin.client
      .from("menu_events")
      .select("action, version_id, actor_id")
      .eq("venue_id", venue)
      .order("id")
    expect(events!.map((e) => e.action)).toEqual([
      "draft_created",
      "draft_created",
      "activated",
      "draft_created",
      "draft_saved",
      "retired",
      "activated",
      "retired",
      "discarded",
    ])
    expect(new Set(events!.map((e) => e.actor_id))).toEqual(new Set([admin.id]))
  })

  it("concurrent activations of two drafts leave exactly one active version", async () => {
    const v = (await createVenue(service, "menus-race")).id
    const doc = menu("Race", [section("s", "S", [item("s--x", "X")])])
    const d1 = await createDraft(admin, v, doc)
    const d2 = await createDraft(admin, v, doc)
    const results = await Promise.all(
      [d1, d2].map((id) =>
        admin.client.rpc("activate_menu_version", {
          p_version_id: id,
          p_expected_revision: 1,
        })
      )
    )
    expect(results.every((r) => r.error === null)).toBe(true)
    const { data } = await service
      .from("menu_versions")
      .select("status")
      .eq("venue_id", v)
    expect(data!.map((r) => r.status).sort()).toEqual(["active", "retired"])
  })
})

describe("identity rules (A1.3)", () => {
  let venue: string

  beforeAll(async () => {
    venue = (await createVenue(service, "menus-ids")).id
  })

  it("re-saving with ids keeps item and variant identities; null ids always create new ones", async () => {
    const draft = await createDraft(
      admin,
      venue,
      menu("Ids", [
        section("curries", "Curries", [
          item("curries--korma", "Korma", { variants: ["Chicken", "Lamb"] }),
        ]),
      ])
    )
    const before = await readDocument(service, draft)
    const korma = before.byKey["curries--korma"]!

    // Carry ids forward, rename and move to another section, reorder variants.
    const carried = menu("Ids v2", [
      section("house", "House specials", [
        item("curries--korma", "Royal korma", {
          itemId: korma.itemId,
          variants: [
            { variantId: korma.variants[1]!.variantId, name: "Lamb" },
            { variantId: korma.variants[0]!.variantId, name: "Chicken" },
            "Prawn",
          ],
        }),
      ]),
    ])
    const r1 = await admin.client.rpc("save_menu_draft", {
      p_version_id: draft,
      p_expected_revision: 1,
      p_document: asJson(carried),
    })
    expect(r1.error).toBeNull()
    const after = await readDocument(service, draft)
    const moved = after.byKey["curries--korma"]!
    expect(moved.itemId).toBe(korma.itemId)
    expect(moved.sectionSlug).toBe("house")
    expect(moved.variants.map((v) => v.variantId).slice(0, 2)).toEqual([
      korma.variants[1]!.variantId,
      korma.variants[0]!.variantId,
    ])
    expect(after.title).toBe("Ids v2")

    // Same source key and names but null ids: the database never reuses by key or name.
    const fresh = menu("Ids v3", [
      section("house", "House specials", [
        item("curries--korma", "Royal korma", { variants: ["Lamb"] }),
      ]),
    ])
    const r2 = await admin.client.rpc("save_menu_draft", {
      p_version_id: draft,
      p_expected_revision: 2,
      p_document: asJson(fresh),
    })
    expect(r2.error).toBeNull()
    const third = await readDocument(service, draft)
    expect(third.byKey["curries--korma"]!.itemId).not.toBe(korma.itemId)
    expect(third.byKey["curries--korma"]!.variants[0]!.variantId).not.toBe(
      korma.variants[1]!.variantId
    )
  })

  it("rejects malformed documents with invalid_menu_document and a path", async () => {
    const draft = await createDraft(
      admin,
      venue,
      menu("Base", [
        section("s", "S", [
          item("s--a", "A", { variants: ["One"] }),
          item("s--b", "B"),
        ]),
      ])
    )
    const base = await readDocument(service, draft)
    const a = base.byKey["s--a"]!
    const b = base.byKey["s--b"]!
    const tooManySections = Array.from({ length: 101 }, (_, i) =>
      section(`s${i}`, `S${i}`, [])
    )
    const cases: [string, unknown][] = [
      ["$", "not an object"],
      ["sections", { title: "T" }],
      ["title", { title: "", sections: [] }],
      ["sections", { title: "T", sections: tooManySections }],
      ["sections[0].slug", menu("T", [section("Bad Slug", "S", [])])],
      [
        "sections[1].slug",
        menu("T", [section("s", "S", []), section("s", "S2", [])]),
      ],
      [
        "sections[0].items[1].itemId",
        menu("T", [
          section("s", "S", [
            item("s--a", "A", { itemId: a.itemId }),
            item("s--a2", "A2", { itemId: a.itemId }),
          ]),
        ]),
      ],
      [
        "sections[0].items[0].itemId",
        menu("T", [
          section("s", "S", [item("s--a", "A", { itemId: "not-a-uuid" })]),
        ]),
      ],
      [
        "sections[0].items[1].sourceKey",
        menu("T", [
          section("s", "S", [item("s--a", "A"), item("s--a", "A again")]),
        ]),
      ],
      [
        "sections[0].items[0].sourceKey",
        menu("T", [section("s", "S", [item("Bad Key", "A")])]),
      ],
      [
        "sections[0].items[0].name",
        menu("T", [section("s", "S", [item("s--a", "  ")])]),
      ],
      [
        "sections[0].items[0].description",
        menu("T", [
          section("s", "S", [
            item("s--a", "A", { description: "x".repeat(601) }),
          ]),
        ]),
      ],
      [
        "sections[0].items[0].aliases",
        menu("T", [
          section("s", "S", [
            item("s--a", "A", {
              aliases: Array.from({ length: 11 }, (_, i) => `a${i}`),
            }),
          ]),
        ]),
      ],
      [
        "sections[0].items[0].variants[1].name",
        menu("T", [
          section("s", "S", [
            item("s--a", "A", { variants: ["Veg", " veg "] }),
          ]),
        ]),
      ],
      [
        "sections[0].items[0].variants",
        menu("T", [
          section("s", "S", [
            item("s--a", "A", {
              variants: Array.from({ length: 13 }, (_, i) => `V${i}`),
            }),
          ]),
        ]),
      ],
      [
        // A variant of another item.
        "sections[0].items[0].variants[0].variantId",
        menu("T", [
          section("s", "S", [
            item("s--b", "B", {
              itemId: b.itemId,
              variants: [{ variantId: a.variants[0]!.variantId, name: "One" }],
            }),
          ]),
        ]),
      ],
      [
        // A variant id on a new item.
        "sections[0].items[0].variants[0].variantId",
        menu("T", [
          section("s", "S", [
            item("s--n", "N", {
              variants: [{ variantId: a.variants[0]!.variantId, name: "One" }],
            }),
          ]),
        ]),
      ],
      [
        "sections[0].items[0].sourceMeta",
        menu("T", [
          section("s", "S", [
            item("s--a", "A", { sourceMeta: { blob: "x".repeat(5000) } }),
          ]),
        ]),
      ],
      [
        "sections[0].items[0].sourceMeta.nested",
        {
          title: "T",
          sections: [
            {
              ...section("s", "S", []),
              items: [
                { ...item("s--a", "A"), sourceMeta: { nested: { a: 1 } } },
              ],
            },
          ],
        },
      ],
    ]
    for (const [path, doc] of cases) {
      const result = await admin.client.rpc("save_menu_draft", {
        p_version_id: draft,
        p_expected_revision: 1,
        p_document: asJson(doc),
      })
      expectDbError(result, "invalid_menu_document", "22023")
      expect(JSON.parse(result.error!.details).path, JSON.stringify(path)).toBe(
        path
      )
    }
    // Nothing was written: still revision 1 with the original content.
    const unchanged = await readDocument(service, draft)
    expect(Object.keys(unchanged.byKey).sort()).toEqual(["s--a", "s--b"])
    const { data: v } = await service
      .from("menu_versions")
      .select("revision")
      .eq("id", draft)
      .single()
    expect(v!.revision).toBe(1)
  })

  it("rejects an invalid source and an unknown or foreign base version", async () => {
    const doc = menu("T", [])
    for (const source of [
      { kind: "pdf" },
      { kind: "json", sha256: "nothex" },
      { kind: "csv", capturedAt: "yesterday-ish" },
      { kind: "json", label: 5 },
      "string",
    ]) {
      const result = await admin.client.rpc("create_menu_draft", {
        p_venue_id: venue,
        p_title: "T",
        p_source: asJson(source),
        p_document: asJson(doc),
      })
      expectDbError(result, "invalid_menu_source", "22023")
    }
    const other = await createDraft(admin, venueB, doc)
    expectDbError(
      await admin.client.rpc("create_menu_draft", {
        p_venue_id: venue,
        p_title: "T",
        p_source: asJson(null),
        p_document: asJson(doc),
        p_based_on: other,
      }),
      "menu_version_not_found",
      "P0002"
    )
    expectDbError(
      await admin.client.rpc("create_menu_draft", {
        p_venue_id: randomUUID(),
        p_title: "T",
        p_source: asJson(null),
        p_document: asJson(doc),
      }),
      "venue_not_found",
      "P0002"
    )
  })

  it("archives and unarchives an item with audit events; idempotent", async () => {
    const v = await publishMenu(
      admin,
      venue,
      menu("Arch", [section("s", "S", [item("s--arch", "Arch")])])
    )
    const id = (await readDocument(service, v)).byKey["s--arch"]!.itemId
    for (const archived of [true, true, false]) {
      const r = await admin.client.rpc("set_menu_item_archived", {
        p_item_id: id,
        p_archived: archived,
      })
      expect(r.error).toBeNull()
    }
    const { data: events } = await admin.client
      .from("menu_events")
      .select("action")
      .eq("item_id", id)
      .order("id")
    expect(events!.map((e) => e.action)).toEqual([
      "item_archived",
      "item_unarchived",
    ])
    expectDbError(
      await admin.client.rpc("set_menu_item_archived", {
        p_item_id: randomUUID(),
        p_archived: true,
      }),
      "menu_item_not_found",
      "P0002"
    )
  })
})

describe("immutability and privileges", () => {
  let venue: string
  let active: string
  let draft: string

  beforeAll(async () => {
    venue = (await createVenue(service, "menus-priv")).id
    active = await publishMenu(
      admin,
      venue,
      menu("Frozen", [
        section("s", "S", [item("s--x", "X", { variants: ["V"] })]),
      ])
    )
    draft = await createDraft(admin, venue, menu("Open", []))
  })

  it("non-draft content and headers are frozen even for the service role", async () => {
    const entryUpdate = await service
      .from("menu_entries")
      .update({ name: "Changed" })
      .eq("version_id", active)
    expectDbError(entryUpdate, "menu_version_not_draft")
    const sectionDelete = await service
      .from("menu_sections")
      .delete()
      .eq("version_id", active)
    expectDbError(sectionDelete, "menu_version_not_draft")
    const { data: ev } = await service
      .from("menu_entry_variants")
      .select("id, menu_entries!inner(version_id)")
      .eq("menu_entries.version_id", active)
    expectDbError(
      await service
        .from("menu_entry_variants")
        .update({ name: "W" })
        .eq("id", ev![0]!.id),
      "menu_version_not_draft"
    )
    expectDbError(
      await service
        .from("menu_versions")
        .update({ title: "Renamed" })
        .eq("id", active),
      "menu_version_immutable"
    )
    expectDbError(
      await service
        .from("menu_versions")
        .update({ venue_id: venueA })
        .eq("id", draft),
      "menu_version_identity_immutable"
    )
    expectDbError(
      await service
        .from("menu_versions")
        .update({ status: "draft" })
        .eq("id", active),
      "menu_version_invalid_transition"
    )
    expectDbError(
      await service
        .from("menu_versions")
        .insert({ venue_id: venue, title: "Sneaky", status: "active" }),
      "menu_version_must_start_draft"
    )
    expectDbError(
      await service
        .from("menu_variants")
        .update({ venue_id: venueA })
        .eq("venue_id", venue),
      "row_immutable"
    )
  })

  it("audit events are append-only for every role", async () => {
    const { data } = await service
      .from("menu_events")
      .select("id")
      .eq("venue_id", venue)
      .limit(1)
      .single()
    const update = await service
      .from("menu_events")
      .update({ action: "discarded" })
      .eq("id", data!.id)
    expect(update.error).not.toBeNull()
    const del = await service.from("menu_events").delete().eq("id", data!.id)
    expect(del.error).not.toBeNull()
    const { count } = await service
      .from("menu_events")
      .select("id", { count: "exact", head: true })
      .eq("id", data!.id)
    expect(count).toBe(1)
  })

  it("authenticated users cannot insert, update or delete any catalogue table directly", async () => {
    const env = getLocalSupabaseEnv()
    const token = (await admin.client.auth.getSession()).data.session!
      .access_token
    const tables = [
      "menu_versions",
      "menu_sections",
      "menu_items",
      "menu_variants",
      "menu_entries",
      "menu_entry_variants",
      "menu_events",
    ]
    for (const table of tables) {
      // menu_entry_variants has no venue column; address it by entry.
      const column = table === "menu_entry_variants" ? "entry_id" : "venue_id"
      for (const [method, body] of [
        ["POST", { [column]: venue }],
        ["PATCH", { [column]: venue }],
        ["DELETE", undefined],
      ] as const) {
        const response = await fetch(
          `${env.url}/rest/v1/${table}?${column}=eq.${venue}`,
          {
            method,
            headers: {
              apikey: env.publishableKey,
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: body ? JSON.stringify(body) : undefined,
          }
        )
        expect(response.status, `${method} ${table}`).toBe(403)
        expect((await response.json()).code).toBe("42501")
      }
    }
  })

  it("staff and inactive admins cannot call catalogue RPCs", async () => {
    const doc = asJson(menu("T", []))
    for (const user of [staffA, inactiveAdmin, inactiveStaff]) {
      const calls = [
        user.client.rpc("create_menu_draft", {
          p_venue_id: venue,
          p_title: "T",
          p_source: asJson(null),
          p_document: doc,
        }),
        user.client.rpc("save_menu_draft", {
          p_version_id: draft,
          p_expected_revision: 1,
          p_document: doc,
        }),
        user.client.rpc("activate_menu_version", {
          p_version_id: draft,
          p_expected_revision: 1,
        }),
        user.client.rpc("retire_menu_version", { p_version_id: active }),
        user.client.rpc("discard_menu_draft", { p_version_id: draft }),
        user.client.rpc("set_menu_item_archived", {
          p_item_id: randomUUID(),
          p_archived: true,
        }),
      ]
      for (const result of await Promise.all(calls)) {
        expectDbError(result, "not_active_admin", "42501")
      }
    }
    const { data } = await service
      .from("menu_versions")
      .select("status, revision")
      .in("id", [active, draft])
      .order("created_at")
    expect(data).toEqual([
      { status: "active", revision: 1 },
      { status: "draft", revision: 1 },
    ])
  })

  it("anonymous callers cannot execute the RPCs or read catalogue rows", async () => {
    const env = getLocalSupabaseEnv()
    const rpc = await fetch(`${env.url}/rest/v1/rpc/retire_menu_version`, {
      method: "POST",
      headers: {
        apikey: env.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_version_id: active }),
    })
    expect([401, 403, 404]).toContain(rpc.status)
    const rows = await fetch(`${env.url}/rest/v1/menu_versions?select=id`, {
      headers: { apikey: env.publishableKey },
    })
    expect(rows.ok).toBe(false)
  })
})

describe("historical meaning across versions", () => {
  it("activate after re-import keeps carried identities; retired content stays readable to admins", async () => {
    const venue = (await createVenue(service, "menus-history")).id
    const v1 = await publishMenu(
      admin,
      venue,
      menu("V1", [section("mains", "Mains", [item("mains--fish", "Fish")])])
    )
    const fish = (await readDocument(service, v1)).byKey["mains--fish"]!
    const v2 = await publishMenu(
      admin,
      venue,
      menu("V2", [
        section("specials", "Specials", [
          item("mains--fish", "Fish & chips", { itemId: fish.itemId }),
        ]),
      ]),
      v1
    )
    const v2Doc = await readDocument(service, v2)
    expect(v2Doc.byKey["mains--fish"]!.itemId).toBe(fish.itemId)
    // The retired version's content is unchanged.
    const v1Doc = await readDocument(service, v1)
    expect(v1Doc.byKey["mains--fish"]).toMatchObject({
      name: "Fish",
      sectionSlug: "mains",
    })
    expect(await countVisible(admin, "menu_entries", "version_id", v1)).toBe(1)
  })
})
