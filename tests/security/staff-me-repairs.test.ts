// Full App v1, S3-R4 repair pass: staff Me and the slot page (spec §6 S3,
// S4; FA-7, FA-21). Migrations 20261118123000 (my_uploads repairs) and
// 20261118123100 (move_my_upload_slot). Each case reproduces the reported
// scenario, then shows it is now refused or read correctly:
//
//   V5   Change slot is one transaction: a refused move keeps the old slot
//   V11  an accepted photo moved to needs_recheck stays accepted on Me
//   K4   a reviewer's Fix label reads as label_corrected
//   E8   a newer photo sent before the retake was asked does not answer it
//   V14  the slot filter finds a slot's photos past the newest page
//   E4   an "I'm not sure" photo says so (labelHelp)
//
// Real signed-in identities through PostgREST; the service role and psql
// only build fixtures and read back.
import { beforeAll, describe, expect, it } from "vitest"

import type { TestIdentity } from "../support/identities"
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
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

type Slot = {
  kind: string
  slotId: string
  name: string
  outcome: string
  reason: string | null
  replacesAssetId: string | null
  retakeAnswered: boolean
}
type Upload = {
  assetId: string
  labelRevision: number
  sharedKinds: string[]
  slots: Slot[]
  labelHelp: boolean
}
type Uploads = { items: Upload[]; next: unknown }

type V = {
  w: World
  version: string
  items: Record<string, CatalogueRow>
  bar: string
  garden: string
}

const head = (itemId: string) =>
  Number(
    psql(
      `select coalesce((select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`
    )
  )

async function venue(label: string): Promise<V> {
  const w = await world(label)
  const version = await publishMenu(
    w.admin,
    w.venue,
    menu("TEST me repairs", [
      section("mains", "Mains", [
        item("mains--pie", "Pie"),
        item("mains--fish", "Fish"),
        item("mains--soup", "Soup"),
      ]),
    ])
  )
  const items = (await readDocument(service, version)).byKey
  const place = (name: string) =>
    psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       values ('${w.venue}', 'area', '${name}', '${w.admin.id}') returning id`
    )
  return { w, version, items, bar: place("Bar"), garden: place("Garden") }
}

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

async function areaPhoto(who: TestIdentity, subject: string) {
  const asset = (await reserveReady(service, who)).id
  await ok(
    who.client.rpc("set_media_area_label", {
      p_asset_id: asset,
      p_subject_id: subject,
    })
  )
  return asset
}

const mine = (who: TestIdentity, args: object = {}) =>
  json<Uploads>(who, "my_uploads", args)

async function one(who: TestIdentity, asset: string): Promise<Upload> {
  const read = await mine(who, { p_asset_id: asset })
  return read.items[0]!
}

const move = (
  who: TestIdentity,
  args: {
    asset: string
    revision: number
    catalogue?: string | null
    kind: "dish" | "area" | "shared"
    target?: string | null
    shared?: string | null
  }
) =>
  call(who, "move_my_upload_slot", {
    p_asset_id: args.asset,
    p_expected_revision: args.revision,
    p_catalogue_version_id: args.catalogue ?? null,
    p_target_kind: args.kind,
    p_target_id: args.target ?? null,
    p_shared_kind: args.shared ?? null,
  })

async function refusedWith(
  p: PromiseLike<{ error: { message: string } | null }>,
  message: string
) {
  const { error } = await p
  expect(error?.message).toBe(message)
}

const retake = (
  who: TestIdentity,
  asset: string,
  itemId: string,
  reason: string
) =>
  ok(
    call(who, "review_menu_item_photo", {
      p_asset_id: asset,
      p_item_id: itemId,
      p_variant_id: null,
      p_decision: "better_photo_requested",
      p_expected_revision: head(itemId),
      p_reason: reason,
    }) as never
  )

const accept = (who: TestIdentity, asset: string, itemId: string) =>
  ok(
    call(who, "review_menu_item_photo", {
      p_asset_id: asset,
      p_item_id: itemId,
      p_variant_id: null,
      p_decision: "accepted",
      p_expected_revision: head(itemId),
      p_make_primary: false,
    }) as never
  )

let v: V
let pie: string
let fish: string
let soup: string

beforeAll(async () => {
  await knowledgeAdmin()
  v = await venue("s3-r4-me")
  pie = v.items["mains--pie"]!.itemId
  fish = v.items["mains--fish"]!.itemId
  soup = v.items["mains--soup"]!.itemId
})

// ---------------------------------------------------------------------------

describe("V5: Change slot in one transaction (move_my_upload_slot)", () => {
  it("keeps the place when the dish save is refused (stale revision)", async () => {
    const asset = await areaPhoto(v.w.staffA, v.bar)
    const before = await one(v.w.staffA, asset)
    expect(before.slots).toEqual([
      expect.objectContaining({ kind: "area", slotId: v.bar }),
    ])
    // The old two-call path cleared the place first, then the label save
    // was refused: the photo was left with no slot.
    await refusedWith(
      move(v.w.staffA, {
        asset,
        revision: before.labelRevision + 5,
        catalogue: v.version,
        kind: "dish",
        target: pie,
      }),
      "label_conflict"
    )
    const after = await one(v.w.staffA, asset)
    expect(after.slots).toEqual([
      expect.objectContaining({
        kind: "area",
        slotId: v.bar,
        outcome: "awaiting_review",
      }),
    ])
  })

  it("keeps the place when the dish is no longer on the menu", async () => {
    const asset = await areaPhoto(v.w.staffA, v.bar)
    const before = await one(v.w.staffA, asset)
    const { error } = await move(v.w.staffA, {
      asset,
      revision: before.labelRevision,
      catalogue: "00000000-0000-4000-8000-00000000dead",
      kind: "dish",
      target: pie,
    })
    expect(error).not.toBeNull()
    expect((await one(v.w.staffA, asset)).slots).toEqual([
      expect.objectContaining({ kind: "area", slotId: v.bar }),
    ])
  })

  it("keeps the dish when the place was retired (dish to place)", async () => {
    const asset = await dishPhoto(v, v.w.staffA, fish)
    const before = await one(v.w.staffA, asset)
    const retired = psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by, retired_at, retired_by, retire_reason)
       values ('${v.w.venue}', 'area', 'Old snug', '${v.w.admin.id}', now(), '${v.w.admin.id}', 'TEST retired') returning id`
    )
    await refusedWith(
      move(v.w.staffA, {
        asset,
        revision: before.labelRevision,
        kind: "area",
        target: retired,
      }),
      "area_unavailable"
    )
    const after = await one(v.w.staffA, asset)
    expect(after.slots).toEqual([
      expect.objectContaining({ kind: "dish", slotId: fish }),
    ])
    expect(after.labelRevision).toBe(before.labelRevision)
  })

  it("moves place to dish, dish to place and to a shared kind when allowed", async () => {
    const asset = await areaPhoto(v.w.staffA, v.garden)
    let row = await one(v.w.staffA, asset)
    const moved = await json<{ changed: boolean }>(
      v.w.staffA,
      "move_my_upload_slot",
      {
        p_asset_id: asset,
        p_expected_revision: row.labelRevision,
        p_catalogue_version_id: v.version,
        p_target_kind: "dish",
        p_target_id: pie,
        p_shared_kind: null,
      }
    )
    expect(moved.changed).toBe(true)
    row = await one(v.w.staffA, asset)
    expect(row.slots).toEqual([
      expect.objectContaining({
        kind: "dish",
        slotId: pie,
        outcome: "awaiting_review",
      }),
    ])
    await ok(
      move(v.w.staffA, {
        asset,
        revision: row.labelRevision,
        kind: "area",
        target: v.bar,
      }) as never
    )
    row = await one(v.w.staffA, asset)
    expect(row.slots).toEqual([
      expect.objectContaining({ kind: "area", slotId: v.bar }),
    ])
    await ok(
      move(v.w.staffA, {
        asset,
        revision: row.labelRevision,
        kind: "shared",
        shared: "team",
      }) as never
    )
    row = await one(v.w.staffA, asset)
    expect(row.slots).toEqual([])
    expect(row.sharedKinds).toEqual(["team"])
  })

  it("refuses once a manager decided, someone else's photo and bad targets", async () => {
    const asset = await dishPhoto(v, v.w.staffA, soup)
    const row = await one(v.w.staffA, asset)
    await accept(v.w.manager, asset, soup)
    await refusedWith(
      move(v.w.staffA, {
        asset,
        revision: row.labelRevision,
        kind: "area",
        target: v.bar,
      }),
      "upload_decided"
    )
    expect((await one(v.w.staffA, asset)).slots).toEqual([
      expect.objectContaining({
        kind: "dish",
        slotId: soup,
        outcome: "public",
      }),
    ])
    const theirs = await dishPhoto(v, v.w.staffB, pie)
    await refusedWith(
      move(v.w.staffA, {
        asset: theirs,
        revision: 1,
        kind: "area",
        target: v.bar,
      }),
      "media_asset_not_found"
    )
    await refusedWith(
      move(v.w.staffA, { asset, revision: 1, kind: "area" }),
      "invalid_target"
    )
    // A photo with no slot is matched again, never "a manager checked it".
    const loose = (await reserveReady(service, v.w.staffA)).id
    await refusedWith(
      move(v.w.staffA, {
        asset: loose,
        revision: 0,
        kind: "area",
        target: v.bar,
      }),
      "upload_no_slot"
    )
  })
})

// ---------------------------------------------------------------------------

describe("V11: an accepted photo set to needs_recheck stays accepted", () => {
  it("reads as its accepted level, never Waiting", async () => {
    const asset = await dishPhoto(v, v.w.staffA, pie)
    await accept(v.w.manager, asset, pie)
    // The menu change that asks for a recheck (S1-MENUS presentation_changed)
    // updates the accepted row in place.
    psql(
      `set session_replication_role = replica;
       update public.menu_item_photos set state = 'needs_recheck', recheck_kind = 'presentation_changed', is_primary = false
       where asset_id = '${asset}' and item_id = '${pie}' and state = 'accepted'`
    )
    const row = await one(v.w.staffA, asset)
    expect(row.slots).toEqual([
      expect.objectContaining({ kind: "dish", slotId: pie, outcome: "public" }),
    ])
    // So Change slot is refused in the database too.
    await refusedWith(
      move(v.w.staffA, {
        asset,
        revision: row.labelRevision,
        kind: "area",
        target: v.bar,
      }),
      "upload_decided"
    )
  })
})

// ---------------------------------------------------------------------------

describe("K4: a reviewer's Fix label shows as Label corrected", () => {
  it("reads label_corrected on the dish the reviewer chose", async () => {
    const asset = await dishPhoto(v, v.w.staffB, soup)
    await ok(
      call(v.w.manager, "assign_menu_item_photo", {
        p_asset_id: asset,
        p_item_id: fish,
        p_variant_id: null,
        p_corrects_item_id: soup,
        p_corrects_variant_id: null,
        p_reason: "It is the fish",
        p_expected_revision: head(fish),
        p_make_primary: false,
      }) as never
    )
    const row = await one(v.w.staffB, asset)
    expect(row.slots).toEqual([
      expect.objectContaining({
        kind: "dish",
        slotId: fish,
        outcome: "label_corrected",
      }),
    ])
  })
})

// ---------------------------------------------------------------------------

describe("E8 and V14: retakes and the slot page", () => {
  let older: string
  let newer: string
  let answer: string
  const reason = "Too dark: use the window light"

  beforeAll(async () => {
    // Two photos of Pie sent together, then the manager asks for a retake of
    // the older one.
    older = await dishPhoto(v, v.w.staffManager, pie)
    newer = await dishPhoto(v, v.w.staffManager, pie)
    await retake(v.w.manager, older, pie, reason)
  })

  it("does not count a photo sent before the retake was asked as its answer (E8)", async () => {
    const read = await mine(v.w.staffManager)
    const old = read.items.find((i) => i.assetId === older)!
    expect(old.slots[0]).toMatchObject({
      outcome: "retake_requested",
      reason,
      retakeAnswered: false,
    })
    const sibling = read.items.find((i) => i.assetId === newer)!
    expect(sibling.slots[0]!.replacesAssetId).toBeNull()
  })

  it("finds the retaken photo and its reason past the newest page (V14)", async () => {
    // Other photos sent since push it off a one-row page.
    await areaPhoto(v.w.staffManager, v.garden)
    await areaPhoto(v.w.staffManager, v.garden)
    const page = await mine(v.w.staffManager, { p_limit: 1 })
    expect(page.items.map((i) => i.assetId)).not.toContain(older)
    const slot = await mine(v.w.staffManager, {
      p_limit: 1,
      p_slot_kind: "dish",
      p_slot_id: pie,
    })
    // Only Pie's photos, newest first: the newer sibling, then (next page) the
    // retaken one.
    expect(slot.items.map((i) => i.assetId)).toEqual([newer])
    const all = await mine(v.w.staffManager, {
      p_slot_kind: "dish",
      p_slot_id: pie,
    })
    expect(all.items.map((i) => i.assetId)).toEqual([newer, older])
    expect(all.items[1]!.slots[0]).toMatchObject({ reason })
    const places = await mine(v.w.staffManager, {
      p_slot_kind: "area",
      p_slot_id: v.garden,
    })
    expect(places.items).toHaveLength(2)
    for (const bad of [
      { p_slot_kind: "dish" },
      { p_slot_kind: "amenity", p_slot_id: pie },
    ])
      await refusedWith(
        call(v.w.staffManager, "my_uploads", bad),
        "invalid_slot"
      )
  })

  it("is answered by a photo sent after it was asked (AC17)", async () => {
    answer = await dishPhoto(v, v.w.staffManager, pie)
    const read = await mine(v.w.staffManager, {
      p_slot_kind: "dish",
      p_slot_id: pie,
    })
    const old = read.items.find((i) => i.assetId === older)!
    expect(old.slots[0]!.retakeAnswered).toBe(true)
    const next = read.items.find((i) => i.assetId === answer)!
    expect(next.slots[0]!.replacesAssetId).toBe(older)
  })

  it("never reads a colleague's photos of the slot", async () => {
    const theirs = await mine(v.w.staffA, {
      p_slot_kind: "dish",
      p_slot_id: pie,
    })
    const ids = theirs.items.map((i) => i.assetId)
    for (const id of [older, newer, answer]) expect(ids).not.toContain(id)
  })
})

// ---------------------------------------------------------------------------

describe("E4: an I'm not sure photo", () => {
  it("says it is with the manager (labelHelp) until it has a label", async () => {
    const asset = (await reserveReady(service, v.w.staffA)).id
    expect((await one(v.w.staffA, asset)).labelHelp).toBe(false)
    await ok(
      call(v.w.staffA, "request_label_help", { p_asset_id: asset }) as never
    )
    const row = await one(v.w.staffA, asset)
    expect(row.labelHelp).toBe(true)
    expect(row.slots).toEqual([])
  })
})
