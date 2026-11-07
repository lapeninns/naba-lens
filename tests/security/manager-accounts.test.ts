// Venue manager accounts: admin conversion (atomic, audited, replayable),
// automatic revocation on any role change, the transitional effective grant
// for staff-held grants, regrants for manager accounts only, and the workspace
// scope the /manager guard reads. Real signed-in identities throughout; the
// service role only builds fixtures and reads state back.
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
  currentMonth,
  fails,
  grantManager,
  legacyStaffGrant,
  makeManager,
  ok,
  psql,
  requestKey,
  review,
  submit,
} from "./coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveOk,
  section,
} from "./menus-fixtures"

const service = serviceClient()
let venueA: string
let venueB: string
let admin: TestIdentity
let admin2: TestIdentity
let chefA: TestIdentity
let managerA: TestIdentity

const staff = (label: string, venueId: string) =>
  createIdentity(service, { label, role: "staff", venueId })

function convert(
  caller: { client: TestIdentity["client"] },
  profileId: string,
  venueId: string,
  key = requestKey(),
  reason: string | null = "TEST conversion"
) {
  return caller.client.rpc("convert_account_to_manager", {
    p_profile_id: profileId,
    p_venue_id: venueId,
    p_reason: reason as string,
    p_client_request_key: key,
  })
}

function convertBack(
  caller: TestIdentity,
  profileId: string,
  venueId: string,
  key = requestKey()
) {
  return caller.client.rpc("convert_manager_to_staff", {
    p_profile_id: profileId,
    p_venue_id: venueId,
    p_reason: "TEST back to staff",
    p_client_request_key: key,
  })
}

async function count(
  table:
    | "media_assets"
    | "coverage_submission_items"
    | "monthly_targets"
    | "coverage_review_events"
    | "coverage_audit_events"
    | "venue_manager_grants",
  column: string,
  value: string
) {
  const { count: n, error } = await service
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value)
  if (error) throw error
  return n ?? 0
}

async function openGrants(profileId: string) {
  const { data, error } = await service
    .from("venue_manager_grants")
    .select("id, venue_id")
    .eq("staff_id", profileId)
    .is("revoked_at", null)
  if (error) throw error
  return data
}

async function grantRow(id: string) {
  const { data, error } = await service
    .from("venue_manager_grants")
    .select("revoked_at, revoke_kind, revoked_by")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

async function scope(who: TestIdentity) {
  const [row] = await ok(who.client.rpc("manager_workspace_scope"))
  return row!
}

/** Can the caller manage the venue (the DB gate behind every manager read)? */
async function canManage(who: TestIdentity, venueId: string) {
  const { error } = await who.client.rpc("coverage_items_page", {
    p_venue_id: venueId,
  })
  if (error && error.message !== "not_venue_manager") throw error
  return error === null
}

/** private.is_active_manager() for a user, through psql (postgres, local only). */
function isActiveManager(userId: string) {
  return psql(
    `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false);
     select private.is_active_manager();`
  )
    .split("\n")
    .pop()
}

/** The scope's effective flag must equal the account rule and the DB predicate. */
function effectiveByRule(userId: string) {
  return psql(
    `select coalesce(p.active and p.role = 'manager'
       and private.effective_manager_venue_id(p.id) = p.venue_id, false)
     from public.profiles p where p.id = '${userId}'`
  )
}

beforeAll(async () => {
  venueA = (await createVenue(service, "mgr-acc-a")).id
  venueB = (await createVenue(service, "mgr-acc-b")).id
  admin = await createIdentity(service, {
    label: "mgr-acc-admin",
    role: "admin",
  })
  admin2 = await createIdentity(service, {
    label: "mgr-acc-admin2",
    role: "admin",
  })
  chefA = await staff("mgr-acc-chef-a", venueA)
  managerA = await staff("mgr-acc-mgr-a", venueA)
  await makeManager(admin, managerA, venueA)
})

describe("conversion to a manager account", () => {
  it("keeps the id and every record, leaves one open grant and audits both rows", async () => {
    const v1 = await publishMenu(
      admin,
      venueA,
      menu("TEST mgr-acc menu", [
        section("mains", "Mains", [item("pie", "Pie")]),
      ])
    )
    const pie = (await readDocument(service, v1)).byKey["pie"]!.itemId
    // C works as staff, holds a staff-held grant (pre-conversion pilot shape),
    // uploads, labels, submits, has a target and reviews a colleague.
    const c = await staff("mgr-acc-c", venueA)
    const oldGrant = await legacyStaffGrant(service, admin, c.id, venueA)
    const photo = await reserveReady(service, c)
    await saveOk(c, {
      asset: photo.id,
      revision: 0,
      items: [{ itemId: pie, variantId: null }],
      catalogue: v1,
    })
    await submit(c, [photo.id])
    await ok(
      admin.client.rpc("set_monthly_target", {
        p_venue_id: venueA,
        p_staff_id: c.id,
        p_period_month: currentMonth(),
        p_target_count: 3,
      })
    )
    const chefPhoto = await reserveReady(service, chefA)
    const [chefItem] = await submit(chefA, [chefPhoto.id])
    await ok(review(c, chefItem!.item_id, 1, "accepted"))

    const before = {
      media: await count("media_assets", "uploader_id", c.id),
      items: await count("coverage_submission_items", "author_id", c.id),
      targets: await count("monthly_targets", "staff_id", c.id),
      reviews: await count("coverage_review_events", "actor_id", c.id),
    }
    const { count: labelsBefore } = await service
      .from("media_label_items")
      .select("*", { count: "exact", head: true })
      .eq("asset_id", photo.id)

    const key = requestKey()
    const [row] = await ok(convert(admin, c.id, venueA, key))
    expect(row).toMatchObject({
      profile_id: c.id,
      role: "manager",
      venue_id: venueA,
      replayed: false,
    })

    const { data: profile } = await service
      .from("profiles")
      .select("id, role, venue_id, active")
      .eq("id", c.id)
      .single()
    expect(profile).toEqual({
      id: c.id,
      role: "manager",
      venue_id: venueA,
      active: true,
    })
    expect({
      media: await count("media_assets", "uploader_id", c.id),
      items: await count("coverage_submission_items", "author_id", c.id),
      targets: await count("monthly_targets", "staff_id", c.id),
      reviews: await count("coverage_review_events", "actor_id", c.id),
    }).toEqual(before)
    const { count: labelsAfter } = await service
      .from("media_label_items")
      .select("*", { count: "exact", head: true })
      .eq("asset_id", photo.id)
    expect(labelsAfter).toBe(labelsBefore)

    expect(await openGrants(c.id)).toEqual([
      { id: row!.grant_id, venue_id: venueA },
    ])
    expect(await grantRow(oldGrant)).toMatchObject({
      revoke_kind: "role_changed",
      revoked_by: admin.id,
    })
    const { data: audit } = await service
      .from("coverage_audit_events")
      .select("entity, entity_id, action, actor_id, actor_role, reason, after")
      .in("entity_id", [c.id, row!.grant_id, oldGrant])
      .order("id")
    expect(
      audit!.map((a) => [a.entity, a.entity_id, a.action, a.actor_role])
    ).toEqual(
      expect.arrayContaining([
        ["manager_grant", oldGrant, "auto_revoked", "admin"],
        ["manager_grant", row!.grant_id, "granted", "admin"],
        ["account_role", c.id, "converted_to_manager", "admin"],
      ])
    )
    const conversion = audit!.find((a) => a.entity === "account_role")!
    expect(conversion).toMatchObject({
      actor_id: admin.id,
      reason: "TEST conversion",
      after: { role: "manager", venueId: venueA, grantId: row!.grant_id },
    })

    // Effective at once, and classified as a manager account.
    expect(await canManage(c, venueA)).toBe(true)
    expect(await scope(c)).toMatchObject({
      role: "manager",
      venue_id: venueA,
      grant_id: row!.grant_id,
      grant_venue_id: venueA,
      effective: true,
    })
  })

  it("replays the same key without new rows and refuses a reused key", async () => {
    const c = await staff("mgr-acc-replay", venueA)
    const key = requestKey()
    const [first] = await ok(convert(admin, c.id, venueA, key))
    const audits = await count("coverage_audit_events", "entity_id", c.id)
    const [again] = await ok(convert(admin, c.id, venueA, key))
    expect(again).toEqual({ ...first, replayed: true })
    expect(await count("coverage_audit_events", "entity_id", c.id)).toBe(audits)
    expect(await count("venue_manager_grants", "staff_id", c.id)).toBe(1)

    await fails(
      convert(admin, c.id, venueB, key),
      "idempotency_key_reused",
      "22023"
    )
    const other = await staff("mgr-acc-replay-other", venueA)
    await fails(
      convert(admin, other.id, venueA, key),
      "idempotency_key_reused",
      "22023"
    )
    // A key is never reused across directions.
    await fails(
      convertBack(admin, c.id, venueA, key),
      "idempotency_key_reused",
      "22023"
    )
    expect((await scope(other)).role).toBe("staff")
  })

  it("is for active admins only, never on themselves, admins or ineligible accounts", async () => {
    const target = await staff("mgr-acc-target", venueA)
    for (const caller of [managerA, chefA]) {
      await fails(
        convert(caller, target.id, venueA),
        "not_active_admin",
        "42501"
      )
    }
    // Anonymous callers have no EXECUTE at all.
    const anon = await convert({ client: anonClient() }, target.id, venueA)
    expect(anon.error?.code).toBe("42501")
    await fails(
      convert(admin, admin.id, venueA),
      "cannot_convert_self",
      "42501"
    )
    await fails(convert(admin, admin2.id, venueA), "account_not_found", "P0002")
    await fails(
      convert(admin, randomUUID(), venueA),
      "account_not_found",
      "P0002"
    )
    const already = await fails(
      convert(admin, managerA.id, venueA),
      "account_not_eligible",
      "P0001"
    )
    expect(already.details).toBe("manager")
    const inactive = await createIdentity(service, {
      label: "mgr-acc-inactive",
      role: "staff",
      venueId: venueA,
      active: false,
    })
    await fails(
      convert(admin, inactive.id, venueA),
      "account_not_eligible",
      "P0001"
    )
    const closed = (await createVenue(service, "mgr-acc-closed", false)).id
    await fails(convert(admin, target.id, closed), "venue_inactive", "P0001")
    await fails(
      convert(admin, target.id, venueA, requestKey(), " "),
      "reason_required",
      "22023"
    )
    await fails(
      convert(admin, target.id, venueA, "bad key!"),
      "invalid_request_key",
      "22023"
    )
    expect((await scope(target)).role).toBe("staff")
    expect(await count("venue_manager_grants", "staff_id", target.id)).toBe(0)
  })
})

describe("conversion back to staff", () => {
  it("revokes the grant as role_changed and ends manager access", async () => {
    const m = await staff("mgr-acc-back", venueA)
    const grant = await makeManager(admin, m, venueA)
    expect(await canManage(m, venueA)).toBe(true)
    await fails(convertBack(chefA, m.id, venueA), "not_active_admin", "42501")
    const key = requestKey()
    const [row] = await ok(convertBack(admin, m.id, venueA, key))
    expect(row).toEqual({
      profile_id: m.id,
      role: "staff",
      venue_id: venueA,
      replayed: false,
    })
    expect(await grantRow(grant)).toMatchObject({
      revoke_kind: "role_changed",
    })
    expect(await canManage(m, venueA)).toBe(false)
    expect(await scope(m)).toMatchObject({
      role: "staff",
      grant_id: null,
      effective: false,
    })
    const [replay] = await ok(convertBack(admin, m.id, venueA, key))
    expect(replay!.replayed).toBe(true)
    await fails(
      convertBack(admin, m.id, venueA),
      "account_not_eligible",
      "P0001"
    )
    const { data: audit } = await service
      .from("coverage_audit_events")
      .select("action")
      .eq("entity", "account_role")
      .eq("entity_id", m.id)
      .order("id")
    expect(audit!.map((a) => a.action)).toEqual([
      "converted_to_manager",
      "converted_to_staff",
    ])
  })

  it("a role change outside the RPC (service role) still revokes the grant", async () => {
    const m = await staff("mgr-acc-reverse", venueA)
    const grant = await makeManager(admin, m, venueA)
    const { error } = await service
      .from("profiles")
      .update({ role: "staff" })
      .eq("id", m.id)
    if (error) throw error
    expect(await grantRow(grant)).toMatchObject({
      revoke_kind: "role_changed",
    })
    // Staff again, but the old grant does not come back.
    expect(await canManage(m, venueA)).toBe(false)
  })

  it("a role change through RLS is refused, even for an admin", async () => {
    const { error } = await admin.client
      .from("profiles")
      .update({ role: "staff" })
      .eq("id", managerA.id)
    // No column privilege on role, and profiles_guard behind it.
    expect(error?.code).toBe("42501")
    expect((await scope(managerA)).role).toBe("manager")
  })
})

describe("admins manage manager accounts", () => {
  it("deactivate and transfer through RLS, then regrant at the new venue", async () => {
    const m = await staff("mgr-acc-deact", venueA)
    const grant = await makeManager(admin, m, venueA)
    const deactivated = await admin.client
      .from("profiles")
      .update({ active: false })
      .eq("id", m.id)
      .select("id")
    expect(deactivated.error).toBeNull()
    expect(deactivated.data).toHaveLength(1)
    expect(await grantRow(grant)).toMatchObject({ revoke_kind: "deactivated" })
    expect(effectiveByRule(m.id)).toBe("f")

    const t = await staff("mgr-acc-transfer", venueA)
    const tGrant = await makeManager(admin, t, venueA)
    const moved = await admin.client
      .from("profiles")
      .update({ venue_id: venueB })
      .eq("id", t.id)
      .select("id")
    expect(moved.data).toHaveLength(1)
    expect(await grantRow(tGrant)).toMatchObject({
      revoke_kind: "venue_changed",
    })
    expect(await scope(t)).toMatchObject({
      role: "manager",
      venue_id: venueB,
      grant_id: null,
      effective: false,
    })
    expect(effectiveByRule(t.id)).toBe("f")
    const regrant = await grantManager(admin, t.id, venueB)
    expect(await scope(t)).toMatchObject({
      grant_id: regrant,
      effective: true,
    })
    expect(effectiveByRule(t.id)).toBe("t")
    expect(await canManage(t, venueB)).toBe(true)
    expect(await canManage(t, venueA)).toBe(false)
  })

  it("grant_venue_manager refuses staff accounts", async () => {
    await fails(
      admin.client.rpc("grant_venue_manager", {
        p_staff_id: chefA.id,
        p_venue_id: venueA,
      }),
      "staff_not_eligible",
      "P0001"
    )
    expect(await count("venue_manager_grants", "staff_id", chefA.id)).toBe(0)
  })

  it("keeps one open grant per account", async () => {
    const { error } = await service.from("venue_manager_grants").insert({
      staff_id: managerA.id,
      venue_id: venueA,
      granted_by: admin.id,
    })
    expect(error?.code).toBe("23505")
  })

  it("a revoked manager stays a manager account: no staff access", async () => {
    const m = await staff("mgr-acc-revoked", venueA)
    const grant = await makeManager(admin, m, venueA)
    await ok(
      admin.client.rpc("revoke_venue_manager", {
        p_grant_id: grant,
        p_reason: "TEST revoke",
      })
    )
    expect(await scope(m)).toMatchObject({
      role: "manager",
      grant_id: null,
      effective: false,
    })
    expect(isActiveManager(m.id)).toBe("t")
    expect(await canManage(m, venueA)).toBe(false)
    await fails(
      m.client.rpc("reserve_media_asset", {
        p_client_upload_key: randomUUID(),
        p_size_bytes: 4,
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: "TEST.jpg",
      }),
      "not_active_staff",
      "42501"
    )
    // The admin can regrant without another conversion.
    await grantManager(admin, m.id, venueA)
    expect((await scope(m)).effective).toBe(true)
  })

  it("lists grants with their effect and offers manager accounts only", async () => {
    const legacy = await staff("mgr-acc-legacy", venueA)
    const legacyGrant = await legacyStaffGrant(
      service,
      admin,
      legacy.id,
      venueA
    )
    const fresh = await staff("mgr-acc-candidate", venueA)
    await makeManager(admin, fresh, venueA)
    const list = await ok(
      admin.client.rpc("venue_manager_grant_list", { p_venue_id: venueA })
    )
    expect(list.find((g) => g.staff_id === managerA.id)).toMatchObject({
      effective: true,
      staff_active: true,
    })
    // Transitional rule: a staff-held grant stays in effect until cut-over.
    expect(list.find((g) => g.grant_id === legacyGrant)).toMatchObject({
      effective: true,
      staff_active: true,
    })

    const unGranted = await staff("mgr-acc-ungranted", venueA)
    const g = await makeManager(admin, unGranted, venueA)
    await ok(
      admin.client.rpc("revoke_venue_manager", {
        p_grant_id: g,
        p_reason: "TEST candidate",
      })
    )
    const candidates = await ok(
      admin.client.rpc("manager_grant_candidates", { p_venue_id: venueA })
    )
    const ids = candidates.map((c) => c.id)
    expect(ids).toContain(unGranted.id)
    expect(ids).not.toContain(managerA.id) // already granted here
    expect(ids).not.toContain(chefA.id) // staff
    expect(ids).not.toContain(legacy.id) // staff with a grant
    expect(candidates.every((c) => c.venue_id === venueA)).toBe(true)
    for (const caller of [managerA, chefA]) {
      await fails(
        caller.client.rpc("manager_grant_candidates", { p_venue_id: venueA }),
        "not_active_admin",
        "42501"
      )
    }
  })
})

describe("classification and scope", () => {
  it("is_active_manager is the account role, not the grant", async () => {
    const revoked = await staff("mgr-acc-class-rev", venueA)
    const g = await makeManager(admin, revoked, venueA)
    await ok(
      admin.client.rpc("revoke_venue_manager", {
        p_grant_id: g,
        p_reason: "TEST class",
      })
    )
    const gone = await staff("mgr-acc-class-gone", venueA)
    await makeManager(admin, gone, venueA)
    await service.from("profiles").update({ active: false }).eq("id", gone.id)
    expect(isActiveManager(managerA.id)).toBe("t")
    expect(isActiveManager(revoked.id)).toBe("t")
    expect(isActiveManager(chefA.id)).toBe("f")
    expect(isActiveManager(admin.id)).toBe("f")
    expect(isActiveManager(gone.id)).toBe("f")
  })

  it("an inactive venue makes the grant ineffective until it is reactivated", async () => {
    const venueC = (await createVenue(service, "mgr-acc-c-venue")).id
    const m = await staff("mgr-acc-venue-off", venueC)
    await makeManager(admin, m, venueC)
    expect(await canManage(m, venueC)).toBe(true)
    await service.from("venues").update({ active: false }).eq("id", venueC)
    expect(await scope(m)).toMatchObject({
      venue_active: false,
      effective: false,
    })
    expect(await canManage(m, venueC)).toBe(false)
    expect(effectiveByRule(m.id)).toBe("f")
    await service.from("venues").update({ active: true }).eq("id", venueC)
    expect((await scope(m)).effective).toBe(true)
    expect(await canManage(m, venueC)).toBe(true)
  })

  it("a staff-held grant stays effective (transitional) but opens no workspace", async () => {
    const legacy = await staff("mgr-acc-legacy-scope", venueA)
    const grant = await legacyStaffGrant(service, admin, legacy.id, venueA)
    expect(await canManage(legacy, venueA)).toBe(true)
    expect(await scope(legacy)).toMatchObject({
      role: "staff",
      grant_id: grant,
      grant_venue_id: venueA,
      effective: false,
    })
    expect(effectiveByRule(legacy.id)).toBe("f")
    const [coverage] = await ok(legacy.client.rpc("coverage_access_scope"))
    expect(coverage).toMatchObject({ role: "staff", manager_venue_id: venueA })
  })

  it("matches the database predicate in every state", async () => {
    for (const who of [managerA, chefA, admin]) {
      const row = await scope(who)
      expect(row.user_id).toBe(who.id)
      expect(row.effective ? "t" : "f").toBe(effectiveByRule(who.id))
    }
    const anon = await anonClient().rpc("manager_workspace_scope")
    expect(anon.error?.code).toBe("42501")
  })
})
