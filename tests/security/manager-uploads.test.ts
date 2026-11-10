// Manager accounts upload, label and group their own photos and videos at
// their managed venue (docs/knowledge/b02-design.md W3, W4, §7.2; owner
// decisions Q1 and Q4). Everything the decision left alone stays as it was:
// a manager account never decides its own menu photo, earns no credit, and
// its uploads reach only it and the venue's reviewers until reviewed. Staff,
// staff holding a grant and admins are unchanged. Real signed-in identities
// through PostgREST; the service role and psql only build fixtures and read
// state back.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { markReady, TINY_BYTES, type TestIdentity } from "../support/identities"
import { insertAsset, ok, psql } from "./coverage-fixtures"
import {
  call,
  count,
  json,
  photo,
  refused,
  service,
  world,
  type World,
} from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

type Reserved = { id: string; original_path: string; venue_id: string }

async function reserveAs(
  who: TestIdentity,
  purpose: "general" | "amenity" = "general",
  mediaType: "image" | "video" = "image"
) {
  const rows = await json<Reserved[]>(who, "reserve_media_asset", {
    p_media_type: mediaType,
    p_extension: mediaType === "image" ? "jpg" : "mp4",
    p_original_filename: `TEST manager.${mediaType === "image" ? "jpg" : "mp4"}`,
    p_size_bytes: 4,
    p_client_upload_key: randomUUID(),
    p_purpose: purpose,
  })
  return rows[0]!
}

/** A ready upload reserved by `who` itself (so it records `who`'s role). */
async function readyUpload(who: TestIdentity) {
  const r = await reserveAs(who)
  await markReady(service, r.id, "image/jpeg")
  return r.id
}

function uploaderRole(id: string) {
  return psql(
    `select coalesce(uploader_role::text, 'null') from public.media_assets where id = '${id}'`
  )
}

/** Uploads through a signed upload token, as the browser does. */
async function putByToken(who: TestIdentity, path: string) {
  const { data: signed, error } = await service.storage
    .from("media")
    .createSignedUploadUrl(path)
  if (error) throw error
  return who.client.storage
    .from("media")
    .uploadToSignedUrl(path, signed.token, TINY_BYTES, {
      contentType: "image/jpeg",
    })
}

const seen = async (who: TestIdentity, id: string) =>
  (await ok(who.client.from("media_assets").select("id").eq("id", id))).length

async function head(itemId: string) {
  const { data, error } = await service
    .from("menu_item_photo_heads")
    .select("revision")
    .eq("item_id", itemId)
    .maybeSingle()
  if (error) throw error
  return data?.revision ?? 1
}

function review(who: TestIdentity, asset: string, itemId: string) {
  return head(itemId).then((revision) =>
    call(who, "review_menu_item_photo", {
      p_asset_id: asset,
      p_item_id: itemId,
      p_variant_id: null,
      p_decision: "accepted",
      p_expected_revision: revision,
      p_make_primary: false,
    })
  )
}

let w: World
let other: World
let version: string
let korma: CatalogueRow

beforeAll(async () => {
  w = await world("mgr-upload")
  other = await world("mgr-upload-other")
  version = await publishMenu(
    w.admin,
    w.venue,
    menu("TEST manager uploads", [
      section("mains", "Mains", [item("mains--korma", "Korma")]),
    ])
  )
  korma = (await readDocument(service, version)).byKey["mains--korma"]!
})

const label = (who: TestIdentity, asset: string) =>
  call(who, "save_media_labels", {
    p_asset_id: asset,
    p_expected_revision: 0,
    p_content_types: ["dish"],
    p_note: null,
    p_items: [{ itemId: korma.itemId, variantId: null }],
    p_catalogue_version_id: version,
  })

describe("uploads (W3)", () => {
  it("reserves photos and videos, for menu and evidence, at the managed venue only", async () => {
    for (const [purpose, type] of [
      ["general", "image"],
      ["amenity", "video"],
    ] as const) {
      const r = await reserveAs(w.manager, purpose, type)
      expect(r.venue_id).toBe(w.venue)
      expect(uploaderRole(r.id)).toBe("manager")
    }
    // Another venue's manager account uploads at its own venue, never here.
    expect((await reserveAs(other.manager)).venue_id).toBe(other.venue)
    const put = await putByToken(
      w.manager,
      (await reserveAs(w.manager)).original_path
    )
    expect(put.error).toBeNull()
    // No write outside a reservation.
    const stray = await w.manager.client.storage
      .from("media")
      .upload(`${w.manager.id}/${randomUUID()}/original.jpg`, TINY_BYTES, {
        contentType: "image/jpeg",
      })
    expect(stray.error).not.toBeNull()
  })

  it("leaves staff, staff with a grant and admins as they were", async () => {
    for (const who of [w.staffA, w.staffManager]) {
      const r = await reserveAs(who)
      expect(r.venue_id).toBe(w.venue)
      expect(uploaderRole(r.id)).toBe("staff")
    }
    await refused(
      w.admin,
      "reserve_media_asset",
      {
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: "TEST.jpg",
        p_size_bytes: 4,
        p_client_upload_key: randomUUID(),
      },
      "not_active_staff",
      "42501"
    )
  })

  it("stops when the grant ends: no new reservation, no open-token write, no labels", async () => {
    const v = await world("mgr-upload-revoke")
    const open = await reserveAs(v.manager)
    const ready = await readyUpload(v.manager)
    const { data: grant } = await service
      .from("venue_manager_grants")
      .select("id")
      .eq("staff_id", v.manager.id)
      .is("revoked_at", null)
      .single()
    await ok(
      v.admin.client.rpc("revoke_venue_manager", {
        p_grant_id: grant!.id,
        p_reason: "TEST grant ended",
      })
    )
    const put = await putByToken(v.manager, open.original_path)
    expect(put.error).not.toBeNull()
    await refused(
      v.manager,
      "reserve_media_asset",
      {
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: "TEST.jpg",
        p_size_bytes: 4,
        p_client_upload_key: randomUUID(),
      },
      "venue_unavailable"
    )
    await refused(
      v.manager,
      "save_media_labels",
      {
        p_asset_id: ready,
        p_expected_revision: 0,
        p_content_types: ["venue"],
        p_note: null,
        p_items: [],
      },
      "media_asset_not_found",
      "P0002"
    )
  })
})

describe("labels (W4)", () => {
  it("labels its own upload; the photo then waits for another reviewer", async () => {
    const mine = await readyUpload(w.manager)
    const work = () =>
      json<{ needs_labels: number }[]>(w.manager, "my_label_work")
    const before = (await work())[0]!.needs_labels
    expect(before).toBeGreaterThanOrEqual(1)
    await ok(label(w.manager, mine))
    expect((await work())[0]!.needs_labels).toBe(before - 1)

    const [ov] = await ok(
      w.manager.client.rpc("manager_menu_photo_overview", {})
    )
    expect(ov!.own_waiting_photos).toBeGreaterThanOrEqual(1)
    // Self-review stays refused (Q2 undecided).
    const self = await review(w.manager, mine, korma.itemId)
    expect(self.error?.message).toBe("self_review_not_allowed")
    // The staff member holding the venue's grant may decide it.
    const decided = await review(w.staffManager, mine, korma.itemId)
    expect(decided.error).toBeNull()
    // Accepted menu photos are not credit inputs (credit comes from task
    // sends only), so the manager account has no credit row.
    expect(
      count(`select count(*) from private.monthly_credit_items(private.current_london_month())
        where author_id = '${w.manager.id}'`)
    ).toBe(0)
  })

  it("never labels a colleague's photo, its staff-era photo or another venue's", async () => {
    const colleague = await photo(w.staffA.id, w.venue)
    const staffEra = (
      await insertAsset(service, { uploader: w.manager.id, venue: w.venue })
    ).id
    for (const asset of [colleague, staffEra])
      await refused(
        w.manager,
        "save_media_labels",
        {
          p_asset_id: asset,
          p_expected_revision: 0,
          p_content_types: ["venue"],
          p_note: null,
          p_items: [],
        },
        "media_asset_not_found",
        "P0002"
      )
    const mine = await readyUpload(w.manager)
    const e = await label(other.manager, mine)
    expect(e.error?.message).toBe("media_asset_not_found")
  })

  it("stages labels while uploading, reads only its own stored drafts", async () => {
    const r = await reserveAs(w.manager)
    expect(
      await json<string>(w.manager, "stage_media_labels", {
        p_asset_id: r.id,
        p_venue_id: w.venue,
        p_input: { assetId: r.id, contentTypes: ["dish"] },
      })
    ).toBe("pending")
    const own = await ok(
      w.manager.client.from("media_pending_labels").select("asset_id")
    )
    expect(own.map((p) => p.asset_id)).toContain(r.id)
    expect(
      await ok(
        w.staffA.client
          .from("media_pending_labels")
          .select("asset_id")
          .eq("asset_id", r.id)
      )
    ).toEqual([])
  })
})

describe("visibility", () => {
  it("shows a new upload to the uploader and authorised reviewers only until reviewed", async () => {
    const mine = await readyUpload(w.manager)
    expect(await seen(w.manager, mine)).toBe(1)
    expect(await seen(w.admin, mine)).toBe(1)
    for (const who of [w.staffA, other.staffA, other.manager])
      expect(await seen(who, mine), who.id).toBe(0)
    expect(
      await json(w.staffA, "community_readable_assets", { p_asset_ids: [mine] })
    ).toEqual([])
    await ok(label(w.manager, mine))
    // The venue's reviewers find the labelled photo; staff and other venues
    // don't.
    for (const [who, n] of [
      [w.staffManager, 1],
      [w.admin, 1],
      [w.staffA, 0],
      [other.manager, 0],
    ] as const)
      expect(
        (
          await json<unknown[]>(who, "menu_item_photo_asset", {
            p_asset_id: mine,
          })
        ).length,
        who.id
      ).toBe(n)
  })

  it("keeps a manager account's staff-era uploads hidden from it", async () => {
    const staffEra = (
      await insertAsset(service, { uploader: w.manager.id, venue: w.venue })
    ).id
    expect(await seen(w.manager, staffEra)).toBe(0)
    expect(
      psql(
        `select uploader_role is null from public.media_assets where id = '${staffEra}'`
      )
    ).toBe("t")
  })
})

describe("groups", () => {
  it("groups its own uploads at its venue, never a colleague's", async () => {
    const g = await json<string>(w.manager, "contribution_group_start", {
      p_key: `TEST-${randomUUID()}`,
      p_subject_kind: "menu_item",
      p_subject_id: korma.itemId,
    })
    const mine = await readyUpload(w.manager)
    expect(
      await json<number>(w.manager, "contribution_group_add", {
        p_group_id: g,
        p_asset_ids: [mine],
      })
    ).toBe(1)
    const colleague = await photo(w.staffA.id, w.venue)
    const e = await refused(
      w.manager,
      "contribution_group_add",
      { p_group_id: g, p_asset_ids: [colleague] },
      "evidence_not_eligible"
    )
    expect(JSON.parse(e.details!)).toMatchObject({ reason: "not_own" })
  })
})

describe("uploader role column", () => {
  it("is fixed once recorded", () => {
    const id = psql(
      `select id from public.media_assets where uploader_role = 'manager' limit 1`
    )
    expect(() =>
      psql(
        `update public.media_assets set uploader_role = 'staff' where id = '${id}'`
      )
    ).toThrow()
  })
})
