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

import { finaliseAsset } from "../../lib/server/media/finalise"
import { actorFor } from "../slice/media-actor"
import { markReady, TINY_BYTES, type TestIdentity } from "../support/identities"
import {
  grantManager,
  insertAsset,
  makeManager,
  ok,
  psql,
  requestKey,
} from "./coverage-fixtures"
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

type Reserved = {
  id: string
  original_path: string
  venue_id: string
  upload_state: string
  reused: boolean
}

const reservation = (
  key: string,
  purpose: "general" | "amenity" = "general",
  mediaType: "image" | "video" = "image"
) => ({
  p_media_type: mediaType,
  p_extension: mediaType === "image" ? "jpg" : "mp4",
  p_original_filename: `TEST manager.${mediaType === "image" ? "jpg" : "mp4"}`,
  p_size_bytes: 4,
  p_client_upload_key: key,
  p_purpose: purpose,
})

async function reserveAs(
  who: TestIdentity,
  purpose: "general" | "amenity" = "general",
  mediaType: "image" | "video" = "image",
  key: string = randomUUID()
) {
  const rows = await json<Reserved[]>(
    who,
    "reserve_media_asset",
    reservation(key, purpose, mediaType)
  )
  return rows[0]!
}

const keyRows = (key: string) =>
  count(
    `select count(*) from public.media_assets where client_upload_key = '${key}'`
  )

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

/** Mints a signed upload token as `who`, as the reserve route does. */
const mintAs = (who: TestIdentity, path: string) =>
  who.client.storage.from("media").createSignedUploadUrl(path)

async function stored(path: string) {
  const { data } = await service.storage.from("media").download(path)
  return data
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

  it("stops when the grant ends: no reservation, token write, staging, finalise or labels; its own stay readable", async () => {
    const v = await world("mgr-upload-revoke")
    const open = await reserveAs(v.manager)
    const sent = await reserveAs(v.manager)
    const ready = await readyUpload(v.manager)
    // A token issued for the open reservation while the grant holds.
    const issued = await mintAs(v.manager, open.original_path)
    expect(issued.error).toBeNull()
    // Bytes stored before the grant ends, finalised after.
    expect((await putByToken(v.manager, sent.original_path)).error).toBeNull()
    expect(
      await json<string>(v.manager, "stage_media_labels", {
        p_asset_id: sent.id,
        p_venue_id: v.venue,
        p_input: { assetId: sent.id, contentTypes: ["dish"] },
      })
    ).toBe("pending")
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
    // The already issued token no longer writes.
    const put = await v.manager.client.storage
      .from("media")
      .uploadToSignedUrl(open.original_path, issued.data!.token, TINY_BYTES, {
        contentType: "image/jpeg",
      })
    expect(put.error).not.toBeNull()
    expect(await stored(open.original_path)).toBeNull()
    expect(
      psql(
        `select upload_state from public.media_assets where id = '${open.id}'`
      )
    ).toBe("uploading")
    // Nor can a new token be minted.
    expect((await mintAs(v.manager, open.original_path)).error).not.toBeNull()
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
      "stage_media_labels",
      {
        p_asset_id: open.id,
        p_venue_id: v.venue,
        p_input: { assetId: open.id, contentTypes: ["dish"] },
      },
      "media_asset_not_found",
      "P0002"
    )
    const key = psql(
      `select client_upload_key from public.media_assets where id = '${sent.id}'`
    )
    expect(
      await finaliseAsset(await actorFor(v.manager), {
        assetId: sent.id,
        idempotencyKey: key,
      })
    ).toMatchObject({ ok: false, status: 403 })
    expect(
      psql(
        `select upload_state from public.media_assets where id = '${sent.id}'`
      )
    ).toBe("uploading")
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
    // It still reads its own uploads and its own draft, and may discard it.
    expect(await seen(v.manager, ready)).toBe(1)
    const drafts = await ok(
      v.manager.client.from("media_pending_labels").select("asset_id")
    )
    expect(drafts.map((d) => d.asset_id)).toEqual([sent.id])
    await ok(
      v.manager.client
        .from("media_pending_labels")
        .delete()
        .eq("asset_id", sent.id)
    )
    expect(
      count(
        `select count(*) from public.media_pending_labels where asset_id = '${sent.id}'`
      )
    ).toBe(0)
  })
})

// A retry with a known upload key returns the earlier reservation. A manager
// account gets back only its own manager-era reservation at the venue it
// manages now; staff keep the original reservation, whatever their venue is
// now (20261110095911).
describe("reservation retries (W3)", () => {
  it("returns a manager-era reservation again at the managed venue", async () => {
    const key = randomUUID()
    const first = await reserveAs(w.manager, "general", "image", key)
    expect(first).toMatchObject({ venue_id: w.venue, reused: false })
    expect(await reserveAs(w.manager, "general", "image", key)).toEqual({
      ...first,
      reused: true,
    })
    await refused(
      w.manager,
      "reserve_media_asset",
      reservation(key, "amenity"),
      "reservation_purpose_mismatch",
      "22023"
    )
    expect(keyRows(key)).toBe(1)
  })

  it("refuses an existing reservation once the grant is revoked, and again returns it after a regrant", async () => {
    const v = await world("mgr-upload-retry-revoke")
    const key = randomUUID()
    const first = await reserveAs(v.manager, "general", "image", key)
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
    const e = await refused(
      v.manager,
      "reserve_media_asset",
      reservation(key),
      "venue_unavailable",
      "P0001"
    )
    expect(JSON.stringify(e)).not.toContain(first.id)
    expect(keyRows(key)).toBe(1)
    await grantManager(v.admin, v.manager.id, v.venue)
    expect(await reserveAs(v.manager, "general", "image", key)).toEqual({
      ...first,
      reused: true,
    })
  })

  it("refuses its own staff-era reservations after becoming a manager account", async () => {
    const v = await world("mgr-upload-retry-staff-era")
    const key = randomUUID()
    const staffEra = await reserveAs(v.staffA, "general", "image", key)
    expect(uploaderRole(staffEra.id)).toBe("staff")
    await makeManager(v.admin, v.staffA, v.venue)
    // Also an upload from before roles were recorded (null).
    const legacy = (
      await insertAsset(service, {
        uploader: v.staffA.id,
        venue: v.venue,
        ready: false,
      })
    ).id
    const legacyKey = psql(
      `select client_upload_key from public.media_assets where id = '${legacy}'`
    )
    // Same venue: the recorded role alone refuses them.
    for (const [k, id] of [
      [key, staffEra.id],
      [legacyKey, legacy],
    ] as const) {
      const e = await refused(
        v.staffA,
        "reserve_media_asset",
        reservation(k),
        "media_asset_not_found",
        "P0002"
      )
      expect(JSON.stringify(e)).not.toContain(id)
      expect(keyRows(k)).toBe(1)
    }
    // A new key reserves a manager-era upload at the same venue.
    const fresh = await reserveAs(v.staffA)
    expect(fresh.venue_id).toBe(v.venue)
    expect(uploaderRole(fresh.id)).toBe("manager")
  })

  it("refuses a reservation from a venue it no longer manages", async () => {
    const v = await world("mgr-upload-retry-moved")
    const key = randomUUID()
    const first = await reserveAs(v.manager, "general", "image", key)
    expect(first.venue_id).toBe(v.venue)
    await ok(
      v.admin.client
        .from("profiles")
        .update({ venue_id: other.venue })
        .eq("id", v.manager.id)
        .select("id")
    )
    await grantManager(v.admin, v.manager.id, other.venue)
    const e = await refused(
      v.manager,
      "reserve_media_asset",
      reservation(key),
      "media_asset_not_found",
      "P0002"
    )
    expect(JSON.stringify(e)).not.toContain(first.id)
    expect(keyRows(key)).toBe(1)
    expect((await reserveAs(v.manager)).venue_id).toBe(other.venue)
  })

  it("leaves staff retries as they were: the original reservation, wherever the account is now", async () => {
    const v = await world("mgr-upload-retry-staff")
    const keys = new Map<TestIdentity, string>()
    const firsts = new Map<TestIdentity, Reserved>()
    for (const who of [v.staffA, v.staffManager, v.manager]) {
      keys.set(who, randomUUID())
      firsts.set(who, await reserveAs(who, "general", "image", keys.get(who)))
    }
    // Moved to another venue; still holding a legacy grant; a manager account
    // converted back to staff.
    await ok(
      v.admin.client
        .from("profiles")
        .update({ venue_id: other.venue })
        .eq("id", v.staffA.id)
        .select("id")
    )
    await ok(
      v.admin.client.rpc("convert_manager_to_staff", {
        p_profile_id: v.manager.id,
        p_venue_id: v.venue,
        p_reason: "TEST back to staff",
        p_client_request_key: requestKey(),
      })
    )
    for (const who of [v.staffA, v.staffManager, v.manager]) {
      const again = await reserveAs(who, "general", "image", keys.get(who))
      expect(again, who.id).toEqual({ ...firsts.get(who), reused: true })
      expect(again.venue_id, who.id).toBe(v.venue)
      expect(keyRows(keys.get(who)!)).toBe(1)
    }
    expect((await reserveAs(v.staffA)).venue_id).toBe(other.venue)
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

  it("keeps a manager account's staff-era uploads and drafts out of its reach and its label count", async () => {
    const v = await world("mgr-upload-staff-era")
    const staffEra = (
      await insertAsset(service, { uploader: v.manager.id, venue: v.venue })
    ).id
    expect(await seen(v.manager, staffEra)).toBe(0)
    expect(
      psql(
        `select uploader_role is null from public.media_assets where id = '${staffEra}'`
      )
    ).toBe("t")
    expect(await json(v.manager, "my_label_work")).toEqual([
      { needs_labels: 0, needs_attention: 0 },
    ])
    const uploading = (
      await insertAsset(service, {
        uploader: v.manager.id,
        venue: v.venue,
        ready: false,
      })
    ).id
    await ok(
      service.from("media_pending_labels").insert({
        asset_id: uploading,
        uploader_id: v.manager.id,
        venue_id: v.venue,
        input: { assetId: uploading },
      })
    )
    expect(
      await ok(v.manager.client.from("media_pending_labels").select("asset_id"))
    ).toEqual([])
  })

  it("leaves a manager account's staff-era uploads out of its feed, label work and groups; staff unchanged", async () => {
    const v = await world("mgr-upload-own-reads")
    const staffEra = (
      await insertAsset(service, { uploader: v.manager.id, venue: v.venue })
    ).id
    const managerEra = await readyUpload(v.manager)
    const staffOwn = await readyUpload(v.staffA)
    const staffOld = (
      await insertAsset(service, { uploader: v.staffA.id, venue: v.venue })
    ).id
    // A label save that failed to apply, on each.
    for (const [asset, uploader] of [
      [staffEra, v.manager.id],
      [managerEra, v.manager.id],
      [staffOwn, v.staffA.id],
    ] as const)
      await ok(
        service.from("media_pending_labels").insert({
          asset_id: asset,
          uploader_id: uploader,
          venue_id: v.venue,
          input: { contentTypes: ["dish"] },
          status: "needs_attention",
          code: "invalid",
        })
      )

    type Feed = {
      items: { type: string; assetId?: string; uploaderRole?: string | null }[]
    }
    const photos = async (who: TestIdentity) =>
      (
        await json<Feed>(who, "my_contributions_feed", {
          p_cursor: null,
          p_limit: 20,
        })
      ).items.filter((i) => i.type === "photo")

    expect(
      (await photos(v.manager)).map((i) => [i.assetId, i.uploaderRole])
    ).toEqual([[managerEra, "manager"]])
    expect(await json(v.manager, "my_label_work")).toEqual([
      { needs_labels: 1, needs_attention: 1 },
    ])

    // Groups: the staff-era upload cannot be added, and a membership made
    // before the account became a manager is not shown to it.
    const g = await json<string>(v.manager, "contribution_group_start", {
      p_key: `TEST-${randomUUID()}`,
      p_subject_kind: "none",
      p_subject_id: null,
    })
    expect(
      await json<number>(v.manager, "contribution_group_add", {
        p_group_id: g,
        p_asset_ids: [managerEra],
      })
    ).toBe(1)
    const e = await refused(
      v.manager,
      "contribution_group_add",
      { p_group_id: g, p_asset_ids: [staffEra] },
      "evidence_not_eligible"
    )
    expect(JSON.parse(e.details!)).toMatchObject({ reason: "not_own" })
    // A pre-manager upload recorded as a staff upload, as well as the one
    // from before roles were recorded (null).
    const staffRole = randomUUID()
    psql(
      `insert into public.media_assets (id, uploader_id, venue_id, original_path,
         original_filename, media_type, size_bytes, client_upload_key, uploader_role)
       values ('${staffRole}', '${v.manager.id}', '${v.venue}',
         '${v.manager.id}/${staffRole}/original.jpg', 'TEST staff era.jpg', 'image', 4,
         '${randomUUID()}', 'staff')`
    )
    await markReady(service, staffRole, "image/jpeg")
    expect(uploaderRole(staffRole)).toBe("staff")
    psql(
      `insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position)
       values ('${g}', '${v.venue}', '${staffEra}', 2), ('${g}', '${v.venue}', '${staffRole}', 3)`
    )
    // Whatever other gate would admit them, neither read shows the manager
    // account its pre-manager uploads; the manager-era member stays.
    expect(
      await json<{ asset_id: string }[]>(
        v.manager,
        "contribution_groups_for_assets",
        { p_asset_ids: [staffEra, staffRole, managerEra] }
      )
    ).toEqual([{ asset_id: managerEra, group_id: g }])
    const group = await json<{ members: { assetId: string }[] }>(
      v.manager,
      "contribution_group",
      { p_group_id: g }
    )
    expect(group.members.map((x) => x.assetId)).toEqual([managerEra])
    // Other viewers keep their reads: an admin sees every member.
    const all = [managerEra, staffEra, staffRole]
    expect(
      (
        await json<{ asset_id: string; group_id: string }[]>(
          v.admin,
          "contribution_groups_for_assets",
          { p_asset_ids: all }
        )
      )
        .map((r) => [r.asset_id, r.group_id])
        .sort()
    ).toEqual(all.map((id) => [id, g]).sort())
    expect(
      (
        await json<{ members: { assetId: string }[] }>(
          v.admin,
          "contribution_group",
          { p_group_id: g }
        )
      ).members.map((x) => x.assetId)
    ).toEqual(all)

    // Staff: every own upload, whatever its recorded role.
    expect(
      (await photos(v.staffA)).map((i) => [i.assetId, i.uploaderRole]).sort()
    ).toEqual(
      [
        [staffOwn, "staff"],
        [staffOld, null],
      ].sort()
    )
    expect(await json(v.staffA, "my_label_work")).toEqual([
      { needs_labels: 2, needs_attention: 1 },
    ])
  })

  it("keeps manager-era uploads out of colleagues' Photos after the account becomes staff (OD-9)", async () => {
    const v = await world("mgr-upload-convert")
    const mine = await readyUpload(v.manager)
    const colleague = await readyUpload(v.staffB)
    await ok(
      v.admin.client.rpc("convert_manager_to_staff", {
        p_profile_id: v.manager.id,
        p_venue_id: v.venue,
        p_reason: "TEST back to staff",
        p_client_request_key: requestKey(),
      })
    )
    expect(
      psql(`select role from public.profiles where id = '${v.manager.id}'`)
    ).toBe("staff")
    expect(
      await json(v.staffA, "community_readable_assets", { p_asset_ids: [mine] })
    ).toEqual([])
    expect(await seen(v.staffA, mine)).toBe(0)
    expect(
      await json(v.staffA, "community_media_page", { p_uploader: v.manager.id })
    ).toEqual([])
    const [member] = await json<{ id: string; media_count: number }[]>(
      v.staffA,
      "community_members",
      { p_member: v.manager.id }
    )
    expect(Number(member!.media_count)).toBe(0)
    // Staff uploads read as before.
    expect(
      (
        await json<{ id: string }[]>(v.staffA, "community_readable_assets", {
          p_asset_ids: [colleague],
        })
      ).map((r) => r.id)
    ).toEqual([colleague])
    expect(
      (
        await json<{ id: string }[]>(v.staffA, "community_media_page", {
          p_uploader: v.staffB.id,
        })
      ).map((r) => r.id)
    ).toContain(colleague)
    // The uploader and admins keep their own access.
    for (const who of [v.manager, v.admin])
      expect(
        (
          await json<{ id: string }[]>(who, "community_readable_assets", {
            p_asset_ids: [mine],
          })
        ).map((r) => r.id)
      ).toEqual([mine])
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
  it("is fixed once recorded, on any update", () => {
    const id = psql(
      `select id from public.media_assets where uploader_role = 'manager' limit 1`
    )
    expect(() =>
      psql(
        `update public.media_assets set uploader_role = 'staff' where id = '${id}'`
      )
    ).toThrow()
    // Also when the column is changed along with another one, or cleared.
    expect(() =>
      psql(
        `update public.media_assets set uploader_role = null, updated_at = now() where id = '${id}'`
      )
    ).toThrow()
    expect(
      psql(`select uploader_role from public.media_assets where id = '${id}'`)
    ).toBe("manager")
  })
})
