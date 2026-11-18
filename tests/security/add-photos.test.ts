// Full App v1 S2-ADD: adding photos at the database (spec §5.2, §5.4, §6 S2;
// AC11, AC21). A photo sent for a slot that was filled meanwhile is kept as a
// useful alternative without adding coverage; a venue change between picking
// and sending lets no label from another venue survive. Real signed-in
// identities through PostgREST; the service role and psql build fixtures.
import { beforeAll, describe, expect, it } from "vitest"

import { createIdentity, type TestIdentity } from "../support/identities"
import { ok, psql } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  call,
  json,
  service,
  world,
  type World,
} from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveLabels,
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

type Slot = {
  slotId: string
  state: string
  counted: boolean
  primaryAssetId: string | null
  pendingCount: number
}
type Coverage = { slots: Slot[]; totals: Record<string, number> }

const coverage = (who: TestIdentity) => json<Coverage>(who, "coverage_slots")

type V = { w: World; version: string; items: Record<string, CatalogueRow> }

async function venue(label: string): Promise<V> {
  const w = await world(label)
  const version = await publishMenu(
    w.admin,
    w.venue,
    menu(`TEST add ${label}`, [
      section("mains", "Mains", [
        item("mains--pie", "Pie"),
        item("mains--momo", "Chicken momo"),
      ]),
    ])
  )
  return { w, version, items: (await readDocument(service, version)).byKey }
}

const head = (itemId: string) =>
  Number(
    psql(
      `select coalesce((select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`
    )
  )

async function dishPhoto(v: V, who: TestIdentity, itemId: string) {
  const asset = await reserveReady(service, who)
  await saveOk(who, {
    asset: asset.id,
    revision: 0,
    items: [{ itemId, variantId: null }],
    catalogue: v.version,
  })
  return asset.id
}

let a: V
let b: V
let mover: TestIdentity

beforeAll(async () => {
  await knowledgeAdmin()
  ;[a, b] = await Promise.all([venue("add-a"), venue("add-b")])
  mover = await createIdentity(service, {
    label: "add-mover",
    role: "staff",
    venueId: a.w.venue,
  })
})

describe("a slot filled meanwhile (spec §5.2)", () => {
  it("keeps the later photo as an alternative and adds no coverage", async () => {
    const pie = a.items["mains--pie"]!.itemId
    const first = await dishPhoto(a, a.w.staffA, pie)
    const set = await call(a.w.manager, "set_menu_item_photo_level", {
      p_asset_id: first,
      p_item_id: pie,
      p_variant_id: null,
      p_level: "public",
      p_expected_revision: head(pie),
    })
    expect(set.error).toBeNull()
    const before = await coverage(a.w.staffB)
    const slot = (c: Coverage) => c.slots.find((s) => s.slotId === pie)!
    expect(slot(before)).toMatchObject({
      state: "covered",
      primaryAssetId: first,
    })

    // A colleague's photo for the same dish, sent from a request opened
    // before it was filled: accepted, not refused, not a failure.
    const later = await dishPhoto(a, a.w.staffB, pie)
    const after = await coverage(a.w.staffB)
    expect(slot(after)).toMatchObject({
      state: "covered",
      primaryAssetId: first,
    })
    expect(after.totals.covered).toBe(before.totals.covered)
    expect(after.totals.total).toBe(before.totals.total)
    // Kept with its label, live, for the manager to compare.
    expect(
      psql(
        `select count(*) from public.media_label_items where asset_id = '${later}' and item_id = '${pie}'`
      )
    ).toBe("1")
    expect(
      psql(
        `select (deleted_at is null)::text from public.media_assets where id = '${later}'`
      )
    ).toBe("true")
  })
})

describe("a venue change before sending (AC11)", () => {
  it("lets no label from another venue onto the photo, before or after the move", async () => {
    const asset = await reserveReady(service, mover)
    const theirs = b.items["mains--momo"]!.itemId
    // Another venue's dish never fits a photo of this venue.
    const foreign = await saveLabels(mover, {
      asset: asset.id,
      revision: 0,
      items: [{ itemId: theirs, variantId: null }],
      catalogue: b.version,
    })
    expect(foreign.error?.message).toBe("menu_catalogue_conflict")

    // The person moves to venue B with the photo still unlabelled.
    await ok(
      service
        .from("profiles")
        .update({ venue_id: b.w.venue })
        .eq("id", mover.id)
    )
    try {
      const after = await saveLabels(mover, {
        asset: asset.id,
        revision: 0,
        items: [{ itemId: theirs, variantId: null }],
      })
      expect(after.error?.message).toBe("menu_catalogue_conflict")
      expect(
        psql(
          `select count(*) from public.media_label_items where asset_id = '${asset.id}'`
        )
      ).toBe("0")
      // Nor can it be handed to venue A's managers from venue B.
      const help = await call(mover, "request_label_help", {
        p_asset_id: asset.id,
      })
      expect(help.error?.message).toBe("upload_access_ended")
    } finally {
      await ok(
        service
          .from("profiles")
          .update({ venue_id: a.w.venue })
          .eq("id", mover.id)
      )
    }
  })
})
