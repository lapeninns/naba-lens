// B05-m1 purpose-specific use grants (contracts/b05-design.md §2, brief
// §13.2). Real signed-in identities through PostgREST; psql only writes the
// registry rows a migration would (destinations, a clearance version, a
// named granter) and reads state back.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  call,
  json,
  photo,
  refused,
  world,
  type World,
} from "./knowledge-fixtures"

type Created = { grantId: string; state: string; replayed: boolean }
type Status = {
  view: string
  state: string
  baseline?: string
  destinations?: { label: string; state: string; until: string | null }[]
  grants?: Record<string, unknown>[]
}

const run = randomUUID().slice(0, 8)
const DEST = `test_int_${run}`
const DEST_OTHER = `test_oth_${run}`
const DEST_OFF = `test_off_${run}`
const DEST_PUBLIC = `test_pub_${run}`
const VERSION = `test-${run}`
const CLEAR = { a_ok: true, b_ok: true }
const key = () => `TEST-${randomUUID()}`

type Who = World["staffA"]

function args(
  asset: string,
  over: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    p_request_key: key(),
    p_asset_id: asset,
    p_destination_key: DEST,
    p_purpose: "general_gallery",
    p_subject_kind: "none",
    p_subject_id: null,
    p_profile_key: null,
    p_effective_from: null,
    p_effective_until: null,
    p_clearance_version: VERSION,
    p_clearance: CLEAR,
    p_note: null,
    ...over,
  }
}

const grant = (who: Who, a: Record<string, unknown>) =>
  json<Created>(who, "media_use_grant_create", a)
const status = (who: Who, asset: string) =>
  json<Status>(who, "asset_use_status", { p_asset_id: asset })

describe("media use grants (B05-02)", () => {
  let w: World
  let other: World

  beforeAll(async () => {
    w = await world("b05-use")
    other = await world("b05-use-other")
    psql(`insert into public.media_use_destinations
        (key, label, audience, venue_id, owner_workstream, requires_derivative, active) values
      ('${DEST}', 'TEST website ${run}', 'internal', '${w.venue}', 'WS5', false, true),
      ('${DEST_OTHER}', 'TEST other ${run}', 'internal', '${other.venue}', 'WS5', false, true),
      ('${DEST_OFF}', 'TEST off ${run}', 'internal', null, 'WS5', false, false),
      ('${DEST_PUBLIC}', 'TEST public ${run}', 'public', null, 'WS5', true, true);
      insert into private.media_use_clearance_versions (version, keys, active)
      values ('${VERSION}', array['a_ok', 'b_ok'], true)`)
  })

  it("refuses staff, managers, the uploader and an admin on their own upload", async () => {
    const asset = await photo(w.staffA.id, w.venue)
    for (const who of [w.staffA, w.staffB, w.manager, w.staffManager])
      await refused(
        who,
        "media_use_grant_create",
        args(asset),
        "not_public_use_granter"
      )
    const own = await photo(w.admin.id, w.venue)
    await refused(
      w.admin,
      "media_use_grant_create",
      args(own),
      "own_upload_not_grantable"
    )
  })

  it("gives the same not-found for deleted, failed, unknown and other-venue assets", async () => {
    const deleted = await photo(w.staffA.id, w.venue)
    psql(
      `update public.media_assets set deleted_at = now() where id = '${deleted}'`
    )
    const failed = randomUUID()
    psql(`insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename, media_type, size_bytes, client_upload_key)
      values ('${failed}', '${w.staffA.id}', '${w.venue}', '${w.staffA.id}/${failed}/original.jpg', 'TEST.jpg', 'image', 4, '${randomUUID()}');
      update public.media_assets set upload_state = 'failed' where id = '${failed}'`)
    for (const id of [deleted, failed, randomUUID()])
      await refused(
        w.admin,
        "media_use_grant_create",
        args(id),
        "media_asset_not_found"
      )
    const elsewhere = await photo(other.staffA.id, other.venue)
    await refused(
      w.admin,
      "media_use_grant_create",
      args(elsewhere),
      "use_destination_unavailable"
    )
  })

  it("refuses inactive and other-venue destinations, a public grant without a profile, and incomplete clearance", async () => {
    const asset = await photo(w.staffA.id, w.venue)
    await refused(
      w.admin,
      "media_use_grant_create",
      args(asset, { p_destination_key: DEST_OFF }),
      "use_destination_unavailable"
    )
    await refused(
      w.admin,
      "media_use_grant_create",
      args(asset, { p_destination_key: DEST_OTHER }),
      "use_destination_unavailable"
    )
    await refused(
      w.admin,
      "media_use_grant_create",
      args(asset, { p_destination_key: DEST_PUBLIC }),
      "derivative_profile_required"
    )
    await refused(
      w.admin,
      "media_use_grant_create",
      args(asset, {
        p_destination_key: DEST_PUBLIC,
        p_profile_key: "public_image",
      }),
      "profile_unavailable"
    )
    for (const clearance of [
      { a_ok: true },
      { a_ok: true, b_ok: false },
      { ...CLEAR, extra: true },
    ])
      await refused(
        w.admin,
        "media_use_grant_create",
        args(asset, { p_clearance: clearance }),
        "clearance_incomplete"
      )
    await refused(
      w.admin,
      "media_use_grant_create",
      args(asset, { p_clearance_version: "proposal-1" }),
      "clearance_incomplete"
    )
  })

  it("replays by request key and refuses a divergent replay", async () => {
    const asset = await photo(w.staffA.id, w.venue)
    const a = args(asset, { p_note: "TEST note" })
    const first = await grant(w.admin, a)
    expect(first).toMatchObject({ state: "in_force", replayed: false })
    expect(await grant(w.admin, a)).toEqual({ ...first, replayed: true })
    await refused(
      w.admin,
      "media_use_grant_create",
      { ...a, p_note: "other" },
      "idempotency_key_reused"
    )
    expect(
      psql(
        `select count(*) from public.media_use_grants where asset_id = '${asset}'`
      )
    ).toBe("1")
  })

  it("computes expiry at read time (frozen now) with no job", async () => {
    const asset = await photo(w.staffA.id, w.venue)
    const until = new Date(Date.now() + 86_400_000).toISOString()
    const { grantId } = await grant(
      w.admin,
      args(asset, { p_effective_until: until })
    )
    const at = (offset: string) =>
      psql(
        `select private.media_use_grant_state(g, now() + interval '${offset}') from public.media_use_grants g where g.id = '${grantId}'`
      )
    expect(at("1 hour")).toBe("in_force")
    expect(at("2 days")).toBe("expired")
    expect(at("-1 day")).toBe("scheduled")
  })

  it("makes withdrawal terminal and idempotent", async () => {
    const asset = await photo(w.staffA.id, w.venue)
    const { grantId } = await grant(w.admin, args(asset))
    const k = key()
    const w1 = {
      p_request_key: k,
      p_grant_id: grantId,
      p_reason_code: "granter_withdrawn",
      p_note: null,
    }
    expect(await json(w.admin, "media_use_grant_withdraw", w1)).toMatchObject({
      withdrawn: 1,
      replayed: false,
    })
    expect(await json(w.admin, "media_use_grant_withdraw", w1)).toMatchObject({
      replayed: true,
    })
    expect(
      await json(w.admin, "media_use_grant_withdraw", {
        ...w1,
        p_request_key: key(),
      })
    ).toMatchObject({ alreadyWithdrawn: true })
    await refused(
      w.admin,
      "media_use_grant_withdraw",
      { ...w1, p_reason_code: "asset_deleted", p_request_key: key() },
      "invalid_reason_code"
    )
    await refused(
      w.staffA,
      "media_use_grant_withdraw",
      { ...w1, p_request_key: key() },
      "not_public_use_granter"
    )
    expect((await status(w.staffA, asset)).state).toBe("withdrawn")
    const again = await grant(w.admin, args(asset))
    expect(again.grantId).not.toBe(grantId)
    expect((await status(w.staffA, asset)).state).toBe("granted")
  })

  it("M1: a withdrawal key replays only for the same command, target, reason and note", async () => {
    const asset = await photo(w.staffA.id, w.venue)
    const g1 = await grant(w.admin, args(asset))
    await grant(w.admin, args(asset))
    const k = key()
    const byGrant = {
      p_request_key: k,
      p_grant_id: g1.grantId,
      p_reason_code: "granter_withdrawn",
      p_note: null,
    }
    expect(
      await json(w.admin, "media_use_grant_withdraw", byGrant)
    ).toMatchObject({ withdrawn: 1 })
    const byAsset = {
      p_request_key: k,
      p_asset_id: asset,
      p_reason_code: "owner_request",
      p_note: null,
    }
    // The reviewer's reproduction: this used to read replayed with nothing
    // withdrawn while the second grant stayed in force.
    await refused(
      w.admin,
      "media_use_withdraw_asset",
      byAsset,
      "idempotency_key_reused"
    )
    expect((await status(w.staffA, asset)).state).toBe("granted")
    const k2 = key()
    expect(
      await json(w.admin, "media_use_withdraw_asset", {
        ...byAsset,
        p_request_key: k2,
      })
    ).toMatchObject({ withdrawn: 1, replayed: false })
    expect((await status(w.staffA, asset)).state).toBe("withdrawn")
    expect(
      await json(w.admin, "media_use_withdraw_asset", {
        ...byAsset,
        p_request_key: k2,
      })
    ).toMatchObject({ withdrawn: 0, replayed: true })
    await refused(
      w.admin,
      "media_use_grant_withdraw",
      { ...byGrant, p_request_key: k2 },
      "idempotency_key_reused"
    )
    const elsewhere = await photo(w.staffA.id, w.venue)
    await refused(
      w.admin,
      "media_use_withdraw_asset",
      { ...byAsset, p_request_key: k2, p_asset_id: elsewhere },
      "idempotency_key_reused"
    )
  })

  it("L1: a withdrawal replay with a changed reason or note is refused", async () => {
    const asset = await photo(w.staffA.id, w.venue)
    const { grantId } = await grant(w.admin, args(asset))
    const byGrant = {
      p_request_key: key(),
      p_grant_id: grantId,
      p_reason_code: "granter_withdrawn",
      p_note: "TEST reason",
    }
    await json(w.admin, "media_use_grant_withdraw", byGrant)
    expect(
      await json(w.admin, "media_use_grant_withdraw", byGrant)
    ).toMatchObject({ replayed: true })
    await refused(
      w.admin,
      "media_use_grant_withdraw",
      { ...byGrant, p_reason_code: "owner_request" },
      "idempotency_key_reused"
    )
    await refused(
      w.admin,
      "media_use_grant_withdraw",
      { ...byGrant, p_note: "changed" },
      "idempotency_key_reused"
    )
    const byAsset = {
      p_request_key: key(),
      p_asset_id: asset,
      p_reason_code: "owner_request",
      p_note: null,
    }
    await json(w.admin, "media_use_withdraw_asset", byAsset)
    await refused(
      w.admin,
      "media_use_withdraw_asset",
      { ...byAsset, p_reason_code: "superseded" },
      "idempotency_key_reused"
    )
    await refused(
      w.admin,
      "media_use_withdraw_asset",
      { ...byAsset, p_note: "changed" },
      "idempotency_key_reused"
    )
  })
  it("L1: an update that does not name use_baseline cannot change it", () => {
    expect(
      psql(
        `select tgattr::text from pg_trigger where tgname = 'media_assets_use_baseline_guard'`
      )
    ).toBe("")
    const id = randomUUID()
    expect(() =>
      psql(`begin;
        insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename, media_type, size_bytes, client_upload_key)
        values ('${id}', '${w.staffA.id}', '${w.venue}', '${w.staffA.id}/${id}/original.jpg', 'TEST.jpg', 'image', 4, '${randomUUID()}');
        update public.media_assets a set (use_baseline, upload_state) = (select 'legacy_unknown', 'processing'::public.upload_state) where a.id = '${id}';
        commit;`)
    ).toThrow(/media_asset_reservation_immutable/)
  })

  it("L2: a row created before the cutover reads legacy_unknown, a new one none", async () => {
    const fresh = await photo(w.staffA.id, w.venue)
    const old = randomUUID()
    psql(`insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename, media_type, size_bytes, client_upload_key, created_at)
      values ('${old}', '${w.staffA.id}', '${w.venue}', '${w.staffA.id}/${old}/original.jpg', 'TEST.jpg', 'image', 4, '${randomUUID()}',
        (select cutover_at - interval '1 day' from private.media_use_settings))`)
    expect(
      psql(`select use_baseline from public.media_assets where id = '${fresh}'`)
    ).toBe("none")
    expect(
      psql(`select use_baseline from public.media_assets where id = '${old}'`)
    ).toBe("legacy_unknown")
    expect((await status(w.staffA, fresh)).state).toBe("not_granted")
  })

  it("L3: a question subject snapshots the check's key and fails closed without K2", async () => {
    const asset = await photo(w.staffA.id, w.venue)
    const check = Object.values(w.checks)[0]!
    const a = args(asset, {
      p_purpose: "amenity_illustration",
      p_subject_kind: "question",
      p_subject_id: check,
    })
    const k2 = psql(
      `select to_regprocedure('private.knowledge_public_media_eligible(uuid,text,timestamptz)') is not null`
    )
    if (k2 === "f") {
      await refused(
        w.admin,
        "media_use_grant_create",
        a,
        "subject_not_publishable"
      )
      return
    }
    // With WS1's K2 present, an ineligible answer is still refused (no
    // question key allows public media until the owner approves one).
    const { error } = await call(w.admin, "media_use_grant_create", a)
    if (error) expect(error.message).toBe("subject_not_publishable")
    else
      expect(
        psql(`select g.subject_key = c.template_key from public.media_use_grants g
          join public.venue_amenity_checks c on c.id = g.subject_id where g.asset_id = '${asset}'`)
      ).toBe("t")
  })

  it("L5: the uploader view hides granter and note; a manager account's staff-era upload is not its own", async () => {
    const asset = await photo(w.staffA.id, w.venue)
    await grant(w.admin, args(asset, { p_note: "TEST secret note" }))
    const mine = await status(w.staffA, asset)
    expect(mine).toMatchObject({ view: "uploader", state: "granted" })
    expect(JSON.stringify(mine)).not.toMatch(/granter|TEST secret note|grantId/)
    const admin = await status(w.admin, asset)
    expect(admin).toMatchObject({ view: "admin", baseline: "none" })
    expect(admin.grants?.[0]).toMatchObject({
      purpose: "general_gallery",
      state: "in_force",
    })
    await refused(
      w.staffB,
      "asset_use_status",
      { p_asset_id: asset },
      "media_asset_not_found"
    )
    await refused(
      other.manager,
      "asset_use_status",
      { p_asset_id: asset },
      "media_asset_not_found"
    )
    const staffEra = randomUUID()
    psql(`insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename, media_type, size_bytes, client_upload_key, uploader_role)
      values ('${staffEra}', '${w.manager.id}', '${w.venue}', '${w.manager.id}/${staffEra}/original.jpg', 'TEST.jpg', 'image', 4, '${randomUUID()}', 'staff')`)
    const { data, error } = await call(w.manager, "asset_use_status", {
      p_asset_id: staffEra,
    })
    if (error) expect(error.message).toBe("media_asset_not_found")
    else expect((data as Status).view).not.toBe("uploader")
  })

  it("keeps grant tables and helpers away from clients", async () => {
    const { error } = await w.admin.client
      .from("media_use_grants" as never)
      .select("id")
    expect(error).not.toBeNull()
    expect(
      psql(
        `select has_function_privilege('authenticated', 'private.media_asset_use_summary(uuid,text)', 'execute')`
      )
    ).toBe("f")
    expect(psql(`select count(*) from public.media_use_granters`)).toBe("0")
  })

  it("leaves the credit function byte-identical", () => {
    expect(
      psql(
        `select md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`
      )
    ).toBe("595b567b933705e692d2f801d750b3fb")
  })
})
