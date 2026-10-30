// v0.3 media label database contract (docs/fanout/CONTRACT-v0.3-menus.md §3 +
// A1): save_media_labels authorisation, availability, snapshots, revisions
// and concurrency, suggestions, label visibility, media_label_details naming
// and library_assets filtering. Real signed-in identities throughout; the
// service role only builds fixtures and reads persisted state back.
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
  reserve,
  reserveReady,
  saveLabels,
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

const service = serviceClient()
let venueA: string
let venueB: string
let admin: TestIdentity
let staffA: TestIdentity
let staffA2: TestIdentity
let staffB: TestIdentity
let inactiveStaff: TestIdentity
let inactiveAdmin: TestIdentity
let activeA: string
let activeB: string
let a: Record<string, CatalogueRow>
let b: Record<string, CatalogueRow>

const tuple = (row: CatalogueRow, variant?: number) => ({
  itemId: row.itemId,
  variantId: variant === undefined ? null : row.variants[variant]!.variantId,
})

beforeAll(async () => {
  venueA = (await createVenue(service, "labels-a")).id
  venueB = (await createVenue(service, "labels-b")).id
  admin = await createIdentity(service, {
    label: "labels-admin",
    role: "admin",
  })
  staffA = await createIdentity(service, {
    label: "labels-staff-a",
    role: "staff",
    venueId: venueA,
  })
  staffA2 = await createIdentity(service, {
    label: "labels-staff-a2",
    role: "staff",
    venueId: venueA,
  })
  staffB = await createIdentity(service, {
    label: "labels-staff-b",
    role: "staff",
    venueId: venueB,
  })
  inactiveStaff = await createIdentity(service, {
    label: "labels-inactive-staff",
    role: "staff",
    venueId: venueA,
  })
  inactiveAdmin = await createIdentity(service, {
    label: "labels-inactive-admin",
    role: "admin",
  })
  activeA = await publishMenu(
    admin,
    venueA,
    menu("A", [
      section("curries", "Curries", [
        item("curries--tikka", "Tikka masala", {
          aliases: ["CTM"],
          variants: ["Chicken", "Paneer"],
        }),
        item("curries--korma", "Korma"),
      ]),
      section(
        "drinks",
        "Drinks",
        [item("drinks--lassi", "Mango lassi")],
        "drinks"
      ),
    ])
  )
  activeB = await publishMenu(
    admin,
    venueB,
    menu("B", [section("mains", "Mains", [item("mains--burger", "Burger")])])
  )
  a = (await readDocument(service, activeA)).byKey
  b = (await readDocument(service, activeB)).byKey
})

async function deactivate(user: TestIdentity) {
  const { error } = await service
    .from("profiles")
    .update({ active: false })
    .eq("id", user.id)
  if (error) throw error
}

async function labelRows(user: TestIdentity, assetId: string) {
  const labels = await user.client
    .from("media_labels")
    .select("asset_id")
    .eq("asset_id", assetId)
  const items = await user.client
    .from("media_label_items")
    .select("id")
    .eq("asset_id", assetId)
  if (labels.error) throw labels.error
  if (items.error) throw items.error
  return { labels: labels.data.length, items: items.data.length }
}

describe("save_media_labels: authorisation and asset state", () => {
  it("staff label their own ready asset; snapshot, has_labels, revision and audit are written; media_assets untouched", async () => {
    const asset = await reserveReady(service, staffA)
    const { data: before } = await service
      .from("media_assets")
      .select("*")
      .eq("id", asset.id)
      .single()
    const saved = await saveOk(staffA, {
      asset: asset.id,
      revision: 0,
      types: ["plating", "dish", "dish"],
      note: "  Friday special  ",
      items: [tuple(a["curries--tikka"]!, 0), tuple(a["curries--tikka"]!, 0)],
      catalogue: activeA,
    })
    expect(saved).toEqual({ revision: 1, has_labels: true })
    const { data: label } = await staffA.client
      .from("media_labels")
      .select("venue_id, content_types, note, has_labels, revision, updated_by")
      .eq("asset_id", asset.id)
      .single()
    expect(label).toEqual({
      venue_id: venueA,
      // Deduplicated, canonical order.
      content_types: ["dish", "plating"],
      note: "Friday special",
      has_labels: true,
      revision: 1,
      updated_by: staffA.id,
    })
    const { data: items } = await staffA.client
      .from("media_label_items")
      .select(
        "item_id, variant_id, item_name, variant_name, section_name, section_slug, version_id, added_by"
      )
      .eq("asset_id", asset.id)
    expect(items).toEqual([
      {
        item_id: a["curries--tikka"]!.itemId,
        variant_id: a["curries--tikka"]!.variants[0]!.variantId,
        item_name: "Tikka masala",
        variant_name: "Chicken",
        section_name: "Curries",
        section_slug: "curries",
        version_id: activeA,
        added_by: staffA.id,
      },
    ])
    const { data: after } = await service
      .from("media_assets")
      .select("*")
      .eq("id", asset.id)
      .single()
    expect(after).toEqual(before)

    const { data: events } = await service
      .from("media_label_events")
      .select("actor_id, actor_role, action, before, after")
      .eq("asset_id", asset.id)
    expect(events).toHaveLength(1)
    expect(events![0]).toMatchObject({
      actor_id: staffA.id,
      actor_role: "staff",
      action: "labels_saved",
      before: {
        revision: 0,
        contentTypes: [],
        note: null,
        items: [],
        missingItem: null,
      },
      after: {
        revision: 1,
        contentTypes: ["dish", "plating"],
        note: "Friday special",
        items: [tuple(a["curries--tikka"]!, 0)],
      },
    })
    // Staff cannot read audit rows.
    const { data: staffEvents } = await staffA.client
      .from("media_label_events")
      .select("id")
      .eq("asset_id", asset.id)
    expect(staffEvents).toEqual([])
  })

  it("another staff member at the same venue cannot label or read the asset (same not-found as unknown)", async () => {
    const asset = await reserveReady(service, staffA)
    await saveOk(staffA, { asset: asset.id, revision: 0, types: ["dish"] })
    const result = await saveLabels(staffA2, {
      asset: asset.id,
      revision: 1,
      types: ["team"],
    })
    expectDbError(result, "media_asset_not_found", "P0002")
    const unknown = await saveLabels(staffA2, {
      asset: crypto.randomUUID(),
      revision: 0,
    })
    expectDbError(unknown, "media_asset_not_found", "P0002")
    expect(await labelRows(staffA2, asset.id)).toEqual({ labels: 0, items: 0 })
    const { data } = await service
      .from("media_labels")
      .select("content_types, revision")
      .eq("asset_id", asset.id)
      .single()
    expect(data).toEqual({ content_types: ["dish"], revision: 1 })
  })

  it("uploading, failed and deleted assets cannot be labelled; labels of a deleted asset become unreadable to staff and admin", async () => {
    const uploading = await reserve(staffA)
    const failed = await reserve(staffA)
    await service
      .from("media_assets")
      .update({ upload_state: "failed" })
      .eq("id", failed.id)
    for (const asset of [uploading, failed]) {
      for (const user of [staffA, admin]) {
        expectDbError(
          await saveLabels(user, {
            asset: asset.id,
            revision: 0,
            types: ["dish"],
          }),
          "media_asset_not_found",
          "P0002"
        )
      }
    }

    const asset = await reserveReady(service, staffA)
    await saveOk(staffA, {
      asset: asset.id,
      revision: 0,
      items: [tuple(a["curries--korma"]!)],
      catalogue: activeA,
    })
    expect(await labelRows(staffA, asset.id)).toEqual({ labels: 1, items: 1 })
    expect(await labelRows(admin, asset.id)).toEqual({ labels: 1, items: 1 })
    const del = await staffA.client.rpc("delete_media_asset", {
      p_asset_id: asset.id,
    })
    expect(del.error).toBeNull()
    expect(await labelRows(staffA, asset.id)).toEqual({ labels: 0, items: 0 })
    expect(await labelRows(admin, asset.id)).toEqual({ labels: 0, items: 0 })
    const details = await admin.client.rpc("media_label_details", {
      p_asset_ids: [asset.id],
    })
    expect(details.data).toEqual([])
    for (const user of [staffA, admin]) {
      expectDbError(
        await saveLabels(user, {
          asset: asset.id,
          revision: 1,
          types: ["dish"],
        }),
        "media_asset_not_found",
        "P0002"
      )
    }
  })

  it("admins label any ready asset; the uploader reads those labels", async () => {
    const asset = await reserveReady(service, staffA)
    const saved = await saveOk(admin, {
      asset: asset.id,
      revision: 0,
      types: ["venue"],
      items: [tuple(a["drinks--lassi"]!)],
      catalogue: activeA,
    })
    expect(saved.revision).toBe(1)
    const { data: events } = await service
      .from("media_label_events")
      .select("actor_role")
      .eq("asset_id", asset.id)
    expect(events).toEqual([{ actor_role: "admin" }])
    expect(await labelRows(staffA, asset.id)).toEqual({ labels: 1, items: 1 })
  })

  it("inactive staff and inactive admins are denied and read nothing", async () => {
    const asset = await reserveReady(service, inactiveStaff)
    await saveOk(inactiveStaff, {
      asset: asset.id,
      revision: 0,
      types: ["team"],
    })
    const adminAsset = await reserveReady(service, staffA)
    await deactivate(inactiveStaff)
    await deactivate(inactiveAdmin)
    expectDbError(
      await saveLabels(inactiveStaff, {
        asset: asset.id,
        revision: 1,
        types: ["dish"],
      }),
      "not_active_user",
      "42501"
    )
    expectDbError(
      await saveLabels(inactiveAdmin, {
        asset: adminAsset.id,
        revision: 0,
        types: ["dish"],
      }),
      "not_active_user",
      "42501"
    )
    expect(await labelRows(inactiveStaff, asset.id)).toEqual({
      labels: 0,
      items: 0,
    })
    const details = await inactiveAdmin.client.rpc("media_label_details", {
      p_asset_ids: [asset.id],
    })
    expect(details.data).toEqual([])
    const lib = await inactiveStaff.client
      .rpc("library_assets", {})
      .select("id")
    expect(lib.data).toEqual([])
    const menus = await inactiveStaff.client.from("menu_items").select("id")
    expect(menus.data).toEqual([])
  })
})

describe("save_media_labels: item availability and snapshots", () => {
  it("rejects an item of another venue via direct RPC (menu_item_wrong_venue)", async () => {
    const asset = await reserveReady(service, staffA)
    const result = await saveLabels(staffA, {
      asset: asset.id,
      revision: 0,
      items: [tuple(b["mains--burger"]!)],
      catalogue: activeA,
    })
    expectDbError(result, "menu_item_wrong_venue", "22023")
    expect(JSON.parse(result.error!.details)).toEqual([
      b["mains--burger"]!.itemId,
    ])
    expect(await labelRows(staffA, asset.id)).toEqual({ labels: 0, items: 0 })
  })

  it("rejects items not in the active version, archived items, unknown items and foreign variants (menu_item_unavailable lists ids)", async () => {
    const venue = (await createVenue(service, "labels-avail")).id
    const staff = await createIdentity(service, {
      label: "labels-avail-staff",
      role: "staff",
      venueId: venue,
    })
    const v1 = await publishMenu(
      admin,
      venue,
      menu("V1", [
        section("s", "S", [
          item("s--keep", "Keep", { variants: ["Small", "Large"] }),
          item("s--drop", "Drop"),
          item("s--arch", "Archive me"),
        ]),
      ])
    )
    const d1 = (await readDocument(service, v1)).byKey
    const draftOnly = await createDraft(
      admin,
      venue,
      menu("Draft", [section("s", "S", [item("s--new", "New in draft")])])
    )
    const newInDraft = (await readDocument(service, draftOnly)).byKey["s--new"]!
    // V2 drops "drop" and the Large variant of "keep".
    const v2 = await publishMenu(
      admin,
      venue,
      menu("V2", [
        section("s", "S", [
          item("s--keep", "Keep", {
            itemId: d1["s--keep"]!.itemId,
            variants: [
              {
                variantId: d1["s--keep"]!.variants[0]!.variantId,
                name: "Small",
              },
            ],
          }),
          item("s--arch", "Archive me", { itemId: d1["s--arch"]!.itemId }),
        ]),
      ])
    )
    await admin.client.rpc("set_menu_item_archived", {
      p_item_id: d1["s--arch"]!.itemId,
      p_archived: true,
    })
    const asset = await reserveReady(service, staff)
    const unknown = crypto.randomUUID()
    const result = await saveLabels(staff, {
      asset: asset.id,
      revision: 0,
      items: [
        tuple(d1["s--keep"]!, 0),
        tuple(d1["s--keep"]!, 1),
        tuple(d1["s--drop"]!),
        tuple(d1["s--arch"]!),
        { itemId: newInDraft.itemId, variantId: null },
        { itemId: unknown, variantId: null },
        // A variant of another item.
        {
          itemId: d1["s--drop"]!.itemId,
          variantId: d1["s--keep"]!.variants[0]!.variantId,
        },
      ],
      catalogue: v2,
    })
    expectDbError(result, "menu_item_unavailable", "P0001")
    expect((JSON.parse(result.error!.details) as string[]).sort()).toEqual(
      [
        d1["s--keep"]!.itemId,
        d1["s--drop"]!.itemId,
        d1["s--arch"]!.itemId,
        newInDraft.itemId,
        unknown,
      ].sort()
    )
    // The available tuple alone saves.
    const ok = await saveOk(staff, {
      asset: asset.id,
      revision: 0,
      items: [tuple(d1["s--keep"]!, 0)],
      catalogue: v2,
    })
    expect(ok.revision).toBe(1)
  })

  it("enforces input limits: content types, note, item count, item shape, missing item, revision", async () => {
    const asset = await reserveReady(service, staffA)
    const cases: [Parameters<typeof saveLabels>[1], string][] = [
      [
        { asset: asset.id, revision: 0, types: ["selfie"] },
        "invalid_content_type",
      ],
      [
        {
          asset: asset.id,
          revision: 0,
          types: ["dish", "plating", "team", "venue", "event"],
        },
        "invalid_content_type",
      ],
      [
        { asset: asset.id, revision: 0, note: "x".repeat(281) },
        "note_too_long",
      ],
      [
        { asset: asset.id, revision: 0, missing: "x".repeat(121) },
        "missing_item_too_long",
      ],
      [{ asset: asset.id, revision: -1 }, "invalid_revision"],
      [
        {
          asset: asset.id,
          revision: 0,
          items: [{ itemId: "nope", variantId: null }],
        },
        "invalid_label_items",
      ],
      [
        {
          asset: asset.id,
          revision: 0,
          items: Array.from({ length: 21 }, () => ({
            itemId: crypto.randomUUID(),
            variantId: null,
          })),
        },
        "invalid_label_items",
      ],
    ]
    for (const [args, code] of cases) {
      expectDbError(await saveLabels(staffA, args), code, "22023")
    }
    const notArray = await staffA.client.rpc("save_media_labels", {
      p_asset_id: asset.id,
      p_expected_revision: 0,
      p_content_types: [],
      p_note: "",
      p_items: asJson({ itemId: a["curries--korma"]!.itemId }),
    })
    expectDbError(notArray, "invalid_label_items", "22023")
    // A 280-character note and four types are fine; blank note is stored as null.
    const ok = await saveOk(staffA, {
      asset: asset.id,
      revision: 0,
      types: ["dish", "plating", "team", "venue"],
      note: "x".repeat(280),
    })
    expect(ok).toEqual({ revision: 1, has_labels: true })
    const cleared = await saveOk(staffA, {
      asset: asset.id,
      revision: 1,
      note: "   ",
    })
    expect(cleared).toEqual({ revision: 2, has_labels: false })
    const { data } = await service
      .from("media_labels")
      .select("note, content_types")
      .eq("asset_id", asset.id)
      .single()
    expect(data).toEqual({ note: null, content_types: [] })
  })

  it("rename, category move, archive and re-import keep existing label snapshots; details show current names (A1.9)", async () => {
    const venue = (await createVenue(service, "labels-history")).id
    const staff = await createIdentity(service, {
      label: "labels-history-staff",
      role: "staff",
      venueId: venue,
    })
    const v1 = await publishMenu(
      admin,
      venue,
      menu("V1", [
        section("mains", "Mains", [
          item("mains--fish", "Fish", { variants: ["Cod", "Haddock"] }),
          item("mains--pie", "Pie"),
        ]),
      ])
    )
    const d1 = (await readDocument(service, v1)).byKey
    const asset = await reserveReady(service, staff)
    await saveOk(staff, {
      asset: asset.id,
      revision: 0,
      items: [tuple(d1["mains--fish"]!, 1), tuple(d1["mains--pie"]!)],
      catalogue: v1,
    })
    const snapshotBefore = await service
      .from("media_label_items")
      .select(
        "id, item_name, variant_name, section_name, section_slug, version_id, added_at"
      )
      .eq("asset_id", asset.id)
      .order("item_name")

    const details = async (user: TestIdentity = staff) => {
      const { data, error } = await user.client.rpc("media_label_details", {
        p_asset_ids: [asset.id],
      })
      if (error) throw error
      return Object.fromEntries(data.map((r) => [r.snapshot_name, r]))
    }

    // A draft rename never supplies names.
    const draft = await createDraft(
      admin,
      venue,
      menu("Draft", [
        section("mains", "Mains", [
          item("mains--fish", "Draft fish", {
            itemId: d1["mains--fish"]!.itemId,
          }),
        ]),
      ]),
      v1
    )
    expect((await details()).Fish).toMatchObject({
      name: "Fish",
      state: "current",
    })
    await admin.client.rpc("discard_menu_draft", { p_version_id: draft })

    // V2: rename fish + variant, move to another section, drop pie; re-import
    // pie under the same source key as a NEW identity (itemId null).
    const v2 = await publishMenu(
      admin,
      venue,
      menu("V2", [
        section("specials", "Specials", [
          item("mains--fish", "Fish & chips", {
            itemId: d1["mains--fish"]!.itemId,
            variants: [
              {
                variantId: d1["mains--fish"]!.variants[1]!.variantId,
                name: "Smoked haddock",
              },
            ],
          }),
          item("mains--pie", "Pie"),
        ]),
      ]),
      v1
    )
    const d2 = (await readDocument(service, v2)).byKey
    expect(d2["mains--pie"]!.itemId).not.toBe(d1["mains--pie"]!.itemId)

    const snapshotAfter = await service
      .from("media_label_items")
      .select(
        "id, item_name, variant_name, section_name, section_slug, version_id, added_at"
      )
      .eq("asset_id", asset.id)
      .order("item_name")
    expect(snapshotAfter.data).toEqual(snapshotBefore.data)

    let rows = await details()
    expect(rows.Fish).toMatchObject({
      name: "Fish & chips",
      variant_name: "Smoked haddock",
      section_name: "Specials",
      section_slug: "specials",
      snapshot_name: "Fish",
      snapshot_variant_name: "Haddock",
      snapshot_section_name: "Mains",
      state: "current",
    })
    // The old pie identity is not in V2: its name falls back to the most
    // recently activated version that has it (V1, now retired).
    expect(rows.Pie).toMatchObject({ name: "Pie", state: "not_on_active_menu" })

    // The staff member can still read the identity attached to their asset.
    const { data: oldPie } = await staff.client
      .from("menu_items")
      .select("id")
      .eq("id", d1["mains--pie"]!.itemId)
    expect(oldPie).toHaveLength(1)

    // Keeping existing tuples is allowed even though pie is unavailable now,
    // and even with a stale catalogue id (no new tuples added).
    const kept = await saveOk(staff, {
      asset: asset.id,
      revision: 1,
      note: "kept",
      items: [tuple(d1["mains--fish"]!, 1), tuple(d1["mains--pie"]!)],
      catalogue: v1,
    })
    expect(kept.revision).toBe(2)

    // Archive fish: existing label stays, state archived.
    await admin.client.rpc("set_menu_item_archived", {
      p_item_id: d1["mains--fish"]!.itemId,
      p_archived: true,
    })
    rows = await details(admin)
    expect(rows.Fish!.state).toBe("archived")

    // Retire V2: names fall back to V2 (most recently activated), never snapshot.
    await admin.client.rpc("retire_menu_version", { p_version_id: v2 })
    rows = await details(admin)
    expect(rows.Fish).toMatchObject({ name: "Fish & chips", state: "archived" })
    await admin.client.rpc("set_menu_item_archived", {
      p_item_id: d1["mains--fish"]!.itemId,
      p_archived: false,
    })
    rows = await details(admin)
    expect(rows.Fish).toMatchObject({
      name: "Fish & chips",
      variant_name: "Smoked haddock",
      state: "not_on_active_menu",
    })

    // A changed variant is a new tuple: it needs an available catalogue.
    const noCatalogue = await saveLabels(staff, {
      asset: asset.id,
      revision: 2,
      items: [tuple(d1["mains--fish"]!, 0)],
    })
    expectDbError(noCatalogue, "menu_item_unavailable", "P0001")

    expectDbError(
      await staff.client.rpc("media_label_details", {
        p_asset_ids: Array.from({ length: 101 }, () => crypto.randomUUID()),
      }),
      "too_many_assets",
      "22023"
    )
  })
})

describe("save_media_labels: concurrency (A1.5, A1.6)", () => {
  it("a stale revision fails with label_conflict and the current revision; nothing is lost", async () => {
    const asset = await reserveReady(service, staffA)
    await saveOk(staffA, { asset: asset.id, revision: 0, types: ["dish"] })
    await saveOk(staffA, { asset: asset.id, revision: 1, types: ["team"] })
    const stale = await saveLabels(staffA, {
      asset: asset.id,
      revision: 1,
      types: ["event"],
    })
    expectDbError(stale, "label_conflict", "40001")
    expect(JSON.parse(stale.error!.details)).toEqual({ revision: 2 })
    const { data } = await service
      .from("media_labels")
      .select("content_types, revision")
      .eq("asset_id", asset.id)
      .single()
    expect(data).toEqual({ content_types: ["team"], revision: 2 })
  })

  it("concurrent first saves: exactly one wins, the others get label_conflict (never a unique violation); no duplicate rows", async () => {
    const asset = await reserveReady(service, staffA)
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        saveLabels(staffA, {
          asset: asset.id,
          revision: 0,
          types: ["dish"],
          items: [tuple(a["curries--tikka"]!, i % 2)],
          missing: `Special ${i}`,
          catalogue: activeA,
        })
      )
    )
    const ok = attempts.filter((r) => r.error === null)
    expect(ok).toHaveLength(1)
    for (const r of attempts.filter((r) => r.error !== null)) {
      expectDbError(r, "label_conflict", "40001")
    }
    const { count: labels } = await service
      .from("media_labels")
      .select("asset_id", { count: "exact", head: true })
      .eq("asset_id", asset.id)
    const { count: items } = await service
      .from("media_label_items")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", asset.id)
    const { count: suggestions } = await service
      .from("menu_item_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", asset.id)
    expect([labels, items, suggestions]).toEqual([1, 1, 1])
  })

  it("adding a tuple with a stale catalogue version fails with menu_catalogue_conflict; edits without new tuples succeed", async () => {
    const venue = (await createVenue(service, "labels-stale")).id
    const staff = await createIdentity(service, {
      label: "labels-stale-staff",
      role: "staff",
      venueId: venue,
    })
    const v1 = await publishMenu(
      admin,
      venue,
      menu("V1", [section("s", "S", [item("s--a", "A"), item("s--b", "B")])])
    )
    const d1 = (await readDocument(service, v1)).byKey
    const asset = await reserveReady(service, staff)
    await saveOk(staff, {
      asset: asset.id,
      revision: 0,
      items: [tuple(d1["s--a"]!)],
      catalogue: v1,
    })
    const v2 = await publishMenu(
      admin,
      venue,
      menu("V2", [
        section("s", "S", [
          item("s--a", "A", { itemId: d1["s--a"]!.itemId }),
          item("s--b", "B", { itemId: d1["s--b"]!.itemId }),
        ]),
      ]),
      v1
    )
    const stale = await saveLabels(staff, {
      asset: asset.id,
      revision: 1,
      items: [tuple(d1["s--a"]!), tuple(d1["s--b"]!)],
      catalogue: v1,
    })
    expectDbError(stale, "menu_catalogue_conflict", "40001")
    expect(JSON.parse(stale.error!.details)).toEqual({ activeVersionId: v2 })
    const missing = await saveLabels(staff, {
      asset: asset.id,
      revision: 1,
      items: [tuple(d1["s--a"]!), tuple(d1["s--b"]!)],
    })
    expectDbError(missing, "menu_catalogue_conflict", "40001")
    // Note edit + removal with the stale id is fine.
    const edited = await saveOk(staff, {
      asset: asset.id,
      revision: 1,
      note: "still fine",
      items: [],
      catalogue: v1,
    })
    expect(edited).toEqual({ revision: 2, has_labels: false })
    const fresh = await saveOk(staff, {
      asset: asset.id,
      revision: 2,
      items: [tuple(d1["s--b"]!)],
      catalogue: v2,
    })
    expect(fresh.revision).toBe(3)
    const { data } = await service
      .from("media_label_items")
      .select("item_id, version_id")
      .eq("asset_id", asset.id)
    expect(data).toEqual([{ item_id: d1["s--b"]!.itemId, version_id: v2 }])
  })
})

describe("staff transfer (spec v0.3 §3.1)", () => {
  it("an asset uploaded at venue A keeps using A's catalogue after the uploader moves to B", async () => {
    const mover = await createIdentity(service, {
      label: "labels-mover",
      role: "staff",
      venueId: venueA,
    })
    const asset = await reserveReady(service, mover)
    const { error } = await service
      .from("profiles")
      .update({ venue_id: venueB })
      .eq("id", mover.id)
    if (error) throw error

    // Still reads A's active catalogue (owns an asset there) and B's (current venue).
    const { data: versions } = await mover.client
      .from("menu_versions")
      .select("id")
      .in("venue_id", [venueA, venueB])
    expect(versions!.map((v) => v.id).sort()).toEqual([activeA, activeB].sort())

    const ok = await saveOk(mover, {
      asset: asset.id,
      revision: 0,
      items: [tuple(a["curries--korma"]!)],
      catalogue: activeA,
    })
    expect(ok.revision).toBe(1)
    const wrong = await saveLabels(mover, {
      asset: asset.id,
      revision: 1,
      items: [tuple(a["curries--korma"]!), tuple(b["mains--burger"]!)],
      catalogue: activeA,
    })
    expectDbError(wrong, "menu_item_wrong_venue", "22023")
    // B's catalogue id for an A asset is a stale/foreign catalogue.
    const foreign = await saveLabels(mover, {
      asset: asset.id,
      revision: 1,
      items: [tuple(a["curries--korma"]!), tuple(b["mains--burger"]!)],
      catalogue: activeB,
    })
    expectDbError(foreign, "menu_catalogue_conflict", "40001")

    // Deleting the last asset at A removes A's catalogue from their view.
    await mover.client.rpc("delete_media_asset", { p_asset_id: asset.id })
    const { data: after } = await mover.client
      .from("menu_versions")
      .select("id")
      .in("venue_id", [venueA, venueB])
    expect(after!.map((v) => v.id)).toEqual([activeB])
  })
})

describe("missing-item suggestions", () => {
  it("upsert, withdraw, resolve and dismiss; staff see only their own", async () => {
    const asset = await reserveReady(service, staffA)
    await saveOk(staffA, {
      asset: asset.id,
      revision: 0,
      missing: "Lamb rogan josh",
    })
    await saveOk(staffA, {
      asset: asset.id,
      revision: 1,
      missing: "Lamb rogan josh (hot)",
    })
    // null leaves it unchanged.
    await saveOk(staffA, { asset: asset.id, revision: 2, types: ["dish"] })
    const { data: open } = await staffA.client
      .from("menu_item_suggestions")
      .select("id, suggested_name, status, venue_id, created_by")
      .eq("asset_id", asset.id)
    expect(open).toEqual([
      {
        id: open![0]!.id,
        suggested_name: "Lamb rogan josh (hot)",
        status: "open",
        venue_id: venueA,
        created_by: staffA.id,
      },
    ])
    expect(
      (
        await staffA2.client
          .from("menu_item_suggestions")
          .select("id")
          .eq("asset_id", asset.id)
      ).data
    ).toEqual([])
    // Admin sees and may also suggest on the same asset (one open each).
    await saveOk(admin, { asset: asset.id, revision: 3, missing: "Rogan josh" })
    const { data: all } = await admin.client
      .from("menu_item_suggestions")
      .select("id, created_by, status")
      .eq("asset_id", asset.id)
    expect(all).toHaveLength(2)

    // Withdraw ("") closes only the caller's own suggestion.
    await saveOk(staffA, { asset: asset.id, revision: 4, missing: "" })
    const { data: afterWithdraw } = await service
      .from("menu_item_suggestions")
      .select("created_by, status")
      .eq("asset_id", asset.id)
      .order("created_at")
    expect(afterWithdraw).toEqual([
      { created_by: staffA.id, status: "withdrawn" },
      { created_by: admin.id, status: "open" },
    ])

    // A new suggestion after withdrawal is a new row.
    await saveOk(staffA, {
      asset: asset.id,
      revision: 5,
      missing: "Rogan josh!",
    })
    const { data: mine } = await staffA.client
      .from("menu_item_suggestions")
      .select("id, status")
      .eq("asset_id", asset.id)
      .eq("status", "open")
    const suggestionId = mine![0]!.id

    expectDbError(
      await staffA.client.rpc("resolve_menu_item_suggestion", {
        p_suggestion_id: suggestionId,
        p_status: "dismissed",
      }),
      "not_active_admin",
      "42501"
    )
    expectDbError(
      await admin.client.rpc("resolve_menu_item_suggestion", {
        p_suggestion_id: suggestionId,
        p_status: "resolved",
      }),
      "invalid_suggestion_item",
      "22023"
    )
    expectDbError(
      await admin.client.rpc("resolve_menu_item_suggestion", {
        p_suggestion_id: suggestionId,
        p_status: "resolved",
        p_item_id: b["mains--burger"]!.itemId,
      }),
      "menu_item_wrong_venue",
      "22023"
    )
    expectDbError(
      await admin.client.rpc("resolve_menu_item_suggestion", {
        p_suggestion_id: suggestionId,
        p_status: "withdrawn",
      }),
      "invalid_suggestion_status",
      "22023"
    )
    const resolved = await admin.client.rpc("resolve_menu_item_suggestion", {
      p_suggestion_id: suggestionId,
      p_status: "resolved",
      p_item_id: a["curries--korma"]!.itemId,
      p_note: " Added as korma ",
    })
    expect(resolved.error).toBeNull()
    expectDbError(
      await admin.client.rpc("resolve_menu_item_suggestion", {
        p_suggestion_id: suggestionId,
        p_status: "dismissed",
      }),
      "menu_item_suggestion_not_open",
      "P0001"
    )
    const { data: done } = await staffA.client
      .from("menu_item_suggestions")
      .select("status, resolved_item_id, resolved_by, resolution_note")
      .eq("id", suggestionId)
      .single()
    expect(done).toEqual({
      status: "resolved",
      resolved_item_id: a["curries--korma"]!.itemId,
      resolved_by: admin.id,
      resolution_note: "Added as korma",
    })
    const adminOpen = all!.find((s) => s.created_by === admin.id)!
    expect(
      (
        await admin.client.rpc("resolve_menu_item_suggestion", {
          p_suggestion_id: adminOpen.id,
          p_status: "dismissed",
        })
      ).error
    ).toBeNull()
    const { data: events } = await admin.client
      .from("menu_events")
      .select("action, detail")
      .eq("venue_id", venueA)
      .in("action", ["suggestion_resolved", "suggestion_dismissed"])
      .order("id")
    expect(events!.map((e) => e.action)).toEqual([
      "suggestion_resolved",
      "suggestion_dismissed",
    ])
  })
})

describe("library_assets (A1.10, A1.12)", () => {
  let venue: string
  let staff1: TestIdentity
  let staff2: TestIdentity
  let version: string
  let d: Record<string, CatalogueRow>
  const assets: Record<string, string> = {}

  beforeAll(async () => {
    venue = (await createVenue(service, "labels-library")).id
    staff1 = await createIdentity(service, {
      label: "labels-lib-1",
      role: "staff",
      venueId: venue,
    })
    staff2 = await createIdentity(service, {
      label: "labels-lib-2",
      role: "staff",
      venueId: venue,
    })
    version = await publishMenu(
      admin,
      venue,
      menu("Lib", [
        section("curries", "Curries", [
          item("curries--tikka", "Tikka 100%_real", {
            aliases: ["Chicken tikka"],
            variants: ["Chicken", "Paneer"],
          }),
          item("curries--korma", "Korma"),
        ]),
        section("drinks", "Drinks", [item("drinks--lassi", "Lassi")], "drinks"),
      ])
    )
    d = (await readDocument(service, version)).byKey
    const label = async (
      key: string,
      owner: TestIdentity,
      args: Omit<Parameters<typeof saveOk>[1], "asset" | "revision">,
      mediaType: "image" | "video" = "image"
    ) => {
      const asset = await reserveReady(service, owner, mediaType)
      assets[key] = asset.id
      if (Object.keys(args).length)
        await saveOk(owner, {
          asset: asset.id,
          revision: 0,
          catalogue: version,
          ...args,
        })
    }
    // Two curries + note (many-to-many: must still appear once).
    await label("both", staff1, {
      items: [tuple(d["curries--tikka"]!, 0), tuple(d["curries--korma"]!)],
      types: ["dish", "plating"],
      note: "Window seat light",
    })
    // Tikka paneer only.
    await label(
      "paneer",
      staff1,
      { items: [tuple(d["curries--tikka"]!, 1)] },
      "video"
    )
    // Korma + Tikka (no variant): item+variant(Chicken) must NOT match.
    await label("split", staff2, {
      items: [tuple(d["curries--korma"]!), tuple(d["curries--tikka"]!)],
      types: ["kitchen"],
    })
    // Content type only, with an open suggestion.
    await label("typeOnly", staff2, { types: ["team"], missing: "Staff curry" })
    // Lassi only.
    await label("lassi", staff2, { items: [tuple(d["drinks--lassi"]!)] })
    // No label row; and a row with nothing (unlabelled).
    await label("none", staff1, {})
    await label("empty", staff1, { note: "just a note" })
  })

  const ids = (rows: { id: string }[] | null) =>
    (rows ?? []).map((r) => r.id).sort()
  const expected = (...keys: string[]) => keys.map((k) => assets[k]!).sort()

  async function lib(user: TestIdentity, args: Record<string, string | null>) {
    const { data, error } = await user.client
      .rpc("library_assets", args)
      .select("id")
      .eq("venue_id", venue)
    if (error) throw error
    return ids(data)
  }

  it("filters by each parameter as admin, with no duplicate rows", async () => {
    expect(await lib(admin, {})).toEqual(
      expected("both", "paneer", "split", "typeOnly", "lassi", "none", "empty")
    )
    expect(await lib(admin, { p_item: d["curries--tikka"]!.itemId })).toEqual(
      expected("both", "paneer", "split")
    )
    expect(
      await lib(admin, {
        p_variant: d["curries--tikka"]!.variants[1]!.variantId,
      })
    ).toEqual(expected("paneer"))
    // Item + variant must match the SAME tuple: "split" has tikka (no variant) and korma.
    expect(
      await lib(admin, {
        p_item: d["curries--tikka"]!.itemId,
        p_variant: d["curries--tikka"]!.variants[0]!.variantId,
      })
    ).toEqual(expected("both"))
    expect(
      await lib(admin, {
        p_item: d["curries--korma"]!.itemId,
        p_variant: d["curries--tikka"]!.variants[0]!.variantId,
      })
    ).toEqual([])
    expect(await lib(admin, { p_category: "curries" })).toEqual(
      expected("both", "paneer", "split")
    )
    expect(await lib(admin, { p_category: "drinks" })).toEqual(
      expected("lassi")
    )
    expect(await lib(admin, { p_content_type: "dish" })).toEqual(
      expected("both")
    )
    expect(await lib(admin, { p_content_type: "team" })).toEqual(
      expected("typeOnly")
    )
    expect(await lib(admin, { p_label_state: "labelled" })).toEqual(
      expected("both", "paneer", "split", "typeOnly", "lassi")
    )
    expect(await lib(admin, { p_label_state: "unlabelled" })).toEqual(
      expected("none", "empty")
    )
    expect(await lib(admin, { p_label_state: "bogus" })).toEqual([])
  })

  it("text search covers notes, snapshots, aliases and open suggestions, with wildcards escaped", async () => {
    expect(await lib(admin, { p_query: "window SEAT" })).toEqual(
      expected("both")
    )
    expect(await lib(admin, { p_query: "korma" })).toEqual(
      expected("both", "split")
    )
    expect(await lib(admin, { p_query: "chicken tikka" })).toEqual(
      expected("both", "paneer", "split")
    )
    expect(await lib(admin, { p_query: "paneer" })).toEqual(expected("paneer"))
    expect(await lib(admin, { p_query: "staff curry" })).toEqual(
      expected("typeOnly")
    )
    expect(await lib(admin, { p_query: "100%_r" })).toEqual(
      expected("both", "paneer", "split")
    )
    // Escaped: a bare % or _ matches literally, not everything.
    expect(await lib(admin, { p_query: "%" })).toEqual(
      expected("both", "paneer", "split")
    )
    expect(await lib(admin, { p_query: "_" })).toEqual(
      expected("both", "paneer", "split")
    )
    expect(await lib(admin, { p_query: "\\" })).toEqual([])
    expect(await lib(admin, { p_query: "   " })).toEqual(
      expected("both", "paneer", "split", "typeOnly", "lassi", "none", "empty")
    )
  })

  it("combines filters and composes with PostgREST filters, order, limit and embeds", async () => {
    expect(
      await lib(admin, {
        p_category: "curries",
        p_content_type: "kitchen",
        p_label_state: "labelled",
        p_query: "korma",
      })
    ).toEqual(expected("split"))
    const { data, error } = await admin.client
      .rpc("library_assets", { p_category: "curries" })
      .select(
        // PostgREST builds the RPC source from selected and filtered
        // columns only: order columns must be selected too.
        "id, created_at, media_type, venue:venues(name), uploader:profiles(display_name)"
      )
      .eq("venue_id", venue)
      .eq("media_type", "image")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(2)
    if (error) throw error
    expect(data.map((r) => r.id)).toEqual([assets.split, assets.both])
    expect(data[0]!.venue).toMatchObject({
      name: expect.stringContaining("labels-library"),
    })
    expect(data[0]!.uploader).toMatchObject({
      display_name: "TEST labels-lib-2",
    })
  })

  it("applies the caller's RLS: staff see only their own assets; others' labels never match", async () => {
    expect(await lib(staff1, {})).toEqual(
      expected("both", "paneer", "none", "empty")
    )
    expect(await lib(staff1, { p_item: d["curries--korma"]!.itemId })).toEqual(
      expected("both")
    )
    expect(await lib(staff2, { p_query: "staff curry" })).toEqual(
      expected("typeOnly")
    )
    expect(await lib(staff1, { p_query: "staff curry" })).toEqual([])
    expect(await lib(staffB, {})).toEqual([])
  })
})

describe("direct writes are denied for authenticated users", () => {
  it("insert, update and delete on label tables return 42501", async () => {
    const env = getLocalSupabaseEnv()
    const asset = await reserveReady(service, staffA)
    await saveOk(staffA, {
      asset: asset.id,
      revision: 0,
      types: ["dish"],
      missing: "X",
    })
    for (const user of [staffA, admin]) {
      const token = (await user.client.auth.getSession()).data.session!
        .access_token
      for (const table of [
        "media_labels",
        "media_label_items",
        "media_label_events",
        "menu_item_suggestions",
      ]) {
        for (const [method, body] of [
          ["POST", { asset_id: asset.id, venue_id: venueA }],
          ["PATCH", { venue_id: venueB }],
          ["DELETE", undefined],
        ] as const) {
          const response = await fetch(
            `${env.url}/rest/v1/${table}?asset_id=eq.${asset.id}`,
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
    }
    const { data } = await service
      .from("media_labels")
      .select("venue_id, revision")
      .eq("asset_id", asset.id)
      .single()
    expect(data).toEqual({ venue_id: venueA, revision: 1 })
  })

  it("label audit rows are append-only even for the service role; label items are immutable", async () => {
    const { data } = await service
      .from("media_label_events")
      .select("id")
      .limit(1)
      .single()
    expect(
      (
        await service
          .from("media_label_events")
          .update({ action: "labels_saved" })
          .eq("id", data!.id)
      ).error
    ).not.toBeNull()
    expect(
      (await service.from("media_label_events").delete().eq("id", data!.id))
        .error
    ).not.toBeNull()
    const { data: li } = await service
      .from("media_label_items")
      .select("id")
      .limit(1)
      .single()
    expectDbError(
      await service
        .from("media_label_items")
        .update({ item_name: "Forged" })
        .eq("id", li!.id),
      "row_immutable"
    )
  })

  it("composite keys reject a label item whose item belongs to another venue, even for the service role", async () => {
    const asset = await reserveReady(service, staffA)
    await saveOk(staffA, { asset: asset.id, revision: 0, types: ["dish"] })
    const forged = await service.from("media_label_items").insert({
      asset_id: asset.id,
      venue_id: venueA,
      item_id: b["mains--burger"]!.itemId,
      item_name: "Burger",
    })
    expect(forged.error?.code).toBe("23503")
    const forgedVenue = await service.from("media_labels").insert({
      asset_id: (await reserveReady(service, staffA)).id,
      venue_id: venueB,
    })
    expect(forgedVenue.error?.code).toBe("23503")
  })
})
