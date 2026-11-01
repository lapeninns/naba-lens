// public.menu_label_counts (20261101110000): labels per menu item of a venue in
// one read, for active admins only. It must return exactly what the admin's
// own RLS read of media_label_items shows, grouped by item (the application's
// previous paged read), so every case compares the RPC with that read.
import { spawnSync } from "node:child_process"

import { beforeAll, describe, expect, it } from "vitest"

import { getMenuVersion } from "../../lib/server/menus"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  expectDbError,
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
let venueA: string
let venueB: string
let venueBig: string
let admin: TestIdentity
let staffA: TestIdentity
let staffBig: TestIdentity
let inactiveAdmin: TestIdentity
let activeA: string
let rows: Record<string, CatalogueRow>

/** The previous application read: every label row the admin may read, paged. */
async function pagedRead(venueId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.client
      .from("media_label_items")
      .select("item_id")
      .eq("venue_id", venueId)
      .order("id")
      .range(from, from + 999)
    if (error) throw error
    for (const r of data) counts[r.item_id] = (counts[r.item_id] ?? 0) + 1
    if (data.length < 1000) return counts
  }
}

async function counts(client: TestIdentity["client"], venueId: string) {
  const { data, error } = await client.rpc("menu_label_counts", {
    p_venue_id: venueId,
  })
  if (error) throw error
  return data as Record<string, number>
}

async function label(
  who: TestIdentity,
  catalogue: string,
  assetItems: { row: CatalogueRow; variant?: number }[]
) {
  const asset = await reserveReady(service, who)
  await saveOk(who, {
    asset: asset.id,
    revision: 0,
    types: ["dish"],
    items: assetItems.map(({ row, variant }) => ({
      itemId: row.itemId,
      variantId: variant === undefined ? null : row.variants[variant]!.variantId,
    })),
    catalogue,
  })
  return asset
}

beforeAll(async () => {
  venueA = (await createVenue(service, "counts-a")).id
  venueB = (await createVenue(service, "counts-b")).id
  venueBig = (await createVenue(service, "counts-big")).id
  admin = await createIdentity(service, { label: "counts-admin", role: "admin" })
  inactiveAdmin = await createIdentity(service, {
    label: "counts-admin-off",
    role: "admin",
    active: false,
  })
  staffA = await createIdentity(service, {
    label: "counts-staff",
    role: "staff",
    venueId: venueA,
  })
  staffBig = await createIdentity(service, {
    label: "counts-staff-big",
    role: "staff",
    venueId: venueBig,
  })
  activeA = await publishMenu(
    admin,
    venueA,
    menu("TEST counts A", [
      section("mains", "Mains", [
        item("mains--stew", "Stew", { variants: ["Small", "Large"] }),
        item("mains--pie", "Pie"),
        item("mains--soup", "Soup"),
      ]),
    ])
  )
  rows = (await readDocument(service, activeA)).byKey
})

describe("menu_label_counts", () => {
  it("is empty for a venue without labels", async () => {
    expect(await counts(admin.client, venueA)).toEqual({})
    expect(await counts(admin.client, venueB)).toEqual({})
    expect(await pagedRead(venueA)).toEqual({})
  })

  it("counts label rows per item exactly as the admin's own read does", async () => {
    await label(staffA, activeA, [{ row: rows["mains--stew"], variant: 0 }])
    await label(staffA, activeA, [
      { row: rows["mains--stew"], variant: 0 },
      { row: rows["mains--stew"], variant: 1 },
      { row: rows["mains--pie"] },
    ])
    await label(staffA, activeA, [{ row: rows["mains--pie"] }])
    const expected = {
      [rows["mains--stew"].itemId]: 3,
      [rows["mains--pie"].itemId]: 2,
    }
    expect(await pagedRead(venueA)).toEqual(expected)
    expect(await counts(admin.client, venueA)).toEqual(expected)
  })

  it("leaves items without labels out of the map, which the app reads as 0", async () => {
    const soup = rows["mains--soup"].itemId
    const map = await counts(admin.client, venueA)
    expect(soup in map).toBe(false)
    const view = await getMenuVersion(await actorFor(admin), activeA)
    if (!view.ok) throw new Error(view.message)
    expect(view.version.labelCounts).toEqual(map)
    expect(view.version.labelCounts[soup] ?? 0).toBe(0)
  })

  it("follows asset deletion", async () => {
    const asset = await label(staffA, activeA, [{ row: rows["mains--soup"] }])
    expect(
      (await counts(admin.client, venueA))[rows["mains--soup"].itemId]
    ).toBe(1)
    const { error } = await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", asset.id)
    expect(error).toBeNull()
    expect(await counts(admin.client, venueA)).toEqual(await pagedRead(venueA))
    expect(
      (await counts(admin.client, venueA))[rows["mains--soup"].itemId]
    ).toBeUndefined()
  })

  it("keeps venues apart", async () => {
    expect(await counts(admin.client, venueB)).toEqual(await pagedRead(venueB))
    expect(await counts(admin.client, venueB)).toEqual({})
  })

  it("matches the paged read on a venue with more than 1,000 labelled items", async () => {
    const ITEMS = 1300
    const LABELLED = 1100
    const big = await publishMenu(
      admin,
      venueBig,
      menu("TEST counts big", [
        ...Array.from({ length: 13 }, (_, s) =>
          section(
            `sec-${s}`,
            `Section ${s}`,
            Array.from({ length: ITEMS / 13 }, (_, k) =>
              item(`sec-${s}--item-${k}`, `Dish ${s}-${k}`)
            )
          )
        ),
      ])
    )
    const all = Object.values((await readDocument(service, big)).byKey).sort(
      (a, b) => a.sourceKey.localeCompare(b.sourceKey)
    )
    expect(all).toHaveLength(ITEMS)
    // 55 assets x 20 items label the first 1,100 items once; 20 more assets
    // label the first 400 again, so counts are 1 or 2 and 200 items have none.
    for (let a = 0; a < LABELLED / 20; a++)
      await label(
        staffBig,
        big,
        all.slice(a * 20, a * 20 + 20).map((row) => ({ row }))
      )
    for (let a = 0; a < 20; a++)
      await label(
        staffBig,
        big,
        all.slice(a * 20, a * 20 + 20).map((row) => ({ row }))
      )
    const paged = await pagedRead(venueBig)
    const viaRpc = await counts(admin.client, venueBig)
    expect(Object.keys(paged).length).toBe(LABELLED)
    expect(Object.values(paged).reduce((n, c) => n + c, 0)).toBe(1500)
    expect(viaRpc).toEqual(paged)
    const unlabelled = all.slice(LABELLED)
    expect(unlabelled).toHaveLength(200)
    for (const row of unlabelled) expect(viaRpc[row.itemId] ?? 0).toBe(0)
    const view = await getMenuVersion(await actorFor(admin), big)
    if (!view.ok) throw new Error(view.message)
    expect(view.version.labelCounts).toEqual(paged)
  }, 240_000)

  it("is refused to staff, to an inactive admin and to anonymous callers", async () => {
    expectDbError(
      await staffA.client.rpc("menu_label_counts", { p_venue_id: venueA }),
      "not_active_admin",
      "42501"
    )
    expectDbError(
      await inactiveAdmin.client.rpc("menu_label_counts", {
        p_venue_id: venueA,
      }),
      "not_active_admin",
      "42501"
    )
    const anon = await createIdentity(service, {
      label: "counts-anon",
      role: "admin",
      session: false,
    })
    const result = await anon.client.rpc("menu_label_counts", {
      p_venue_id: venueA,
    })
    expect(result.error).not.toBeNull()
    expect(result.data).toBeNull()
  })
})

/** Local database as postgres; label rows for assets the RPCs would never label. */
function psql(sql: string) {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url))
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-qAt"], {
    input: sql,
    encoding: "utf8",
  })
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`)
  return result.stdout.trim()
}

// menu_label_counts repeats the admin rule of private.can_read_asset_labels
// (a non-deleted `ready` asset) instead of calling it. This block fails if the
// two ever disagree: every case compares the RPC with what admin RLS on
// media_label_items really returns.
describe("menu_label_counts follows the admin label RLS", () => {
  let venue: string
  let other: string
  let staff: TestIdentity
  let otherStaff: TestIdentity
  let rows: Record<string, CatalogueRow>
  let otherRows: Record<string, CatalogueRow>
  let version: string
  let otherVersion: string

  const labelRowCount = (venueId: string) =>
    Number(
      psql(
        `select count(*) from public.media_label_items where venue_id = '${venueId}'`
      )
    )

  /** Label rows on an asset that is not (or no longer) `ready`/live. */
  const forceLabel = (assetId: string, venueId: string, row: CatalogueRow) =>
    psql(`
      set session_replication_role = replica;
      insert into public.media_labels (asset_id, venue_id, has_labels)
        values ('${assetId}', '${venueId}', true);
      insert into public.media_label_items (asset_id, venue_id, item_id, item_name)
        values ('${assetId}', '${venueId}', '${row.itemId}', 'TEST forced');
    `)

  beforeAll(async () => {
    venue = (await createVenue(service, "drift-a")).id
    other = (await createVenue(service, "drift-b")).id
    staff = await createIdentity(service, {
      label: "drift-staff",
      role: "staff",
      venueId: venue,
    })
    otherStaff = await createIdentity(service, {
      label: "drift-staff-b",
      role: "staff",
      venueId: other,
    })
    const mk = (tag: string) =>
      menu(`TEST drift ${tag}`, [
        section("mains", "Mains", [
          item(`mains--a-${tag}`, `A ${tag}`),
          item(`mains--b-${tag}`, `B ${tag}`),
          item(`mains--c-${tag}`, `C ${tag}`),
          item(`mains--d-${tag}`, `D ${tag}`),
        ]),
      ])
    version = await publishMenu(admin, venue, mk("a"))
    otherVersion = await publishMenu(admin, other, mk("b"))
    rows = (await readDocument(service, version)).byKey
    otherRows = (await readDocument(service, otherVersion)).byKey
  })

  it("agrees on live, deleted, unfinished, failed and other-venue rows", async () => {
    const live = await label(staff, version, [
      { row: rows["mains--a-a"] },
      { row: rows["mains--b-a"] },
    ])
    expect(live.id).toBeTruthy()
    await label(otherStaff, otherVersion, [
      { row: otherRows["mains--a-b"] },
      { row: otherRows["mains--b-b"] },
    ])

    const deleted = await label(staff, version, [{ row: rows["mains--c-a"] }])
    await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deleted.id)

    const uploading = await reserve(staff)
    forceLabel(uploading.id, venue, rows["mains--d-a"])
    const failed = await reserve(staff)
    await service
      .from("media_assets")
      .update({ upload_state: "failed" })
      .eq("id", failed.id)
    forceLabel(failed.id, venue, rows["mains--d-a"])
    const processing = await reserve(staff)
    await service
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", processing.id)
    forceLabel(processing.id, venue, rows["mains--c-a"])

    // The unusable rows exist in the table, so absence below is the rule at work.
    expect(labelRowCount(venue)).toBe(2 + 1 + 3)

    const fromRls = await pagedRead(venue)
    expect(fromRls).toEqual({
      [rows["mains--a-a"].itemId]: 1,
      [rows["mains--b-a"].itemId]: 1,
    })
    expect(await counts(admin.client, venue)).toEqual(fromRls)
    expect(await counts(admin.client, other)).toEqual(await pagedRead(other))
    expect(await counts(admin.client, other)).toEqual({
      [otherRows["mains--a-b"].itemId]: 1,
      [otherRows["mains--b-b"].itemId]: 1,
    })
  })

  it("agrees for a deactivated admin: nothing readable, and the RPC refuses", async () => {
    const gone = await createIdentity(service, {
      label: "drift-admin-gone",
      role: "admin",
    })
    expect(await counts(gone.client, venue)).toEqual(await pagedRead(venue))
    const { error } = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", gone.id)
    expect(error).toBeNull()
    const { data } = await gone.client
      .from("media_label_items")
      .select("item_id")
      .eq("venue_id", venue)
    expect(data).toEqual([])
    expectDbError(
      await gone.client.rpc("menu_label_counts", { p_venue_id: venue }),
      "not_active_admin",
      "42501"
    )
  })
})
