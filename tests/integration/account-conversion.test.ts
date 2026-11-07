// Admin conversion between staff and venue manager accounts through
// lib/server/accounts (venue manager workspace §4.7, §6.2), against the local
// stack with real identities: results, replay, refusals, audit history, and
// the account tooling that now includes manager accounts.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  convertToManager,
  convertToStaff,
  getStaffAccount,
  listAccountRoleHistory,
  listStaffDirectory,
  setStaffActive,
  updateStaffAccount,
  type AccountsContext,
} from "@/lib/server/accounts"
import {
  grantVenueManager,
  listGrantCandidates,
  listManagerGrants,
} from "@/lib/server/coverage/admin"

import { actorFor } from "../slice/media-actor"
import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type Db,
  type TestIdentity,
} from "../support/identities"

const service = serviceClient()
const ctxFor = (caller: Db): AccountsContext => ({ caller, service })
const key = () => randomUUID()

async function profileOf(id: string) {
  const { data, error } = await service
    .from("profiles")
    .select("id, role, venue_id, active")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

async function grantsOf(id: string) {
  const { data, error } = await service
    .from("venue_manager_grants")
    .select("id, venue_id, revoked_at, revoke_kind")
    .eq("staff_id", id)
    .order("granted_at", { ascending: true })
  if (error) throw error
  return data
}

async function auditOf(id: string) {
  const { data, error } = await service
    .from("coverage_audit_events")
    .select("entity, action, reason, actor_id")
    .eq("entity", "account_role")
    .eq("entity_id", id)
    .order("id", { ascending: true })
  if (error) throw error
  return data
}

let venueA: { id: string; name: string }
let venueB: { id: string; name: string }
let closed: { id: string; name: string }
let admin: TestIdentity
let admin2: TestIdentity
let chef: TestIdentity

beforeAll(async () => {
  venueA = await createVenue(service, "conv-a")
  venueB = await createVenue(service, "conv-b")
  closed = await createVenue(service, "conv-closed", false)
  admin = await createIdentity(service, { label: "conv-admin", role: "admin" })
  admin2 = await createIdentity(service, {
    label: "conv-admin2",
    role: "admin",
  })
  chef = await createIdentity(service, {
    label: "conv-chef",
    role: "staff",
    venueId: venueA.id,
  })
})

describe("convert a staff account to a venue manager", () => {
  let person: TestIdentity

  beforeAll(async () => {
    person = await createIdentity(service, {
      label: "conv-person",
      role: "staff",
      venueId: venueA.id,
    })
  })

  it("converts, assigns the venue, grants access and records the change", async () => {
    const requestId = key()
    const result = await convertToManager(ctxFor(admin.client), {
      requestId,
      profileId: person.id,
      venueId: venueB.id,
      reason: "TEST runs the bar",
    })
    expect(result).toMatchObject({
      ok: true,
      profileId: person.id,
      role: "manager",
      venueId: venueB.id,
      replayed: false,
    })
    if (!result.ok) throw new Error("unreachable")
    expect(result.grantId).toBeTruthy()

    expect(await profileOf(person.id)).toMatchObject({
      role: "manager",
      venue_id: venueB.id,
      active: true,
    })
    const open = (await grantsOf(person.id)).filter((g) => !g.revoked_at)
    expect(open).toEqual([
      expect.objectContaining({ id: result.grantId, venue_id: venueB.id }),
    ])
    expect(await auditOf(person.id)).toEqual([
      {
        entity: "account_role",
        action: "converted_to_manager",
        reason: "TEST runs the bar",
        actor_id: admin.id,
      },
    ])

    // The same request id replays the first result and changes nothing.
    expect(
      await convertToManager(ctxFor(admin.client), {
        requestId,
        profileId: person.id,
        venueId: venueB.id,
        reason: "TEST runs the bar",
      })
    ).toMatchObject({ ok: true, replayed: true, grantId: result.grantId })
    expect(await auditOf(person.id)).toHaveLength(1)

    // Reused for another change, it is refused.
    expect(
      await convertToManager(ctxFor(admin.client), {
        requestId,
        profileId: chef.id,
        venueId: venueA.id,
        reason: "TEST other",
      })
    ).toMatchObject({ ok: false, code: "state_conflict" })
    expect((await profileOf(chef.id)).role).toBe("staff")
  })

  it("shows the account type history to the admin", async () => {
    const history = await listAccountRoleHistory(
      ctxFor(admin.client),
      person.id
    )
    expect(history).toMatchObject({
      ok: true,
      changes: [
        {
          actorName: "TEST conv-admin",
          from: "staff",
          to: "manager",
          venueId: venueB.id,
          reason: "TEST runs the bar",
        },
      ],
    })
    expect(
      await listAccountRoleHistory(ctxFor(chef.client), person.id)
    ).toMatchObject({ ok: false, code: "not_permitted" })
  })

  it("lists the manager account in the directory and its staff page", async () => {
    const directory = await listStaffDirectory(ctxFor(admin.client))
    if (!directory.ok) throw new Error(directory.error)
    const row = directory.staff.find((s) => s.id === person.id)
    expect(row).toMatchObject({ role: "manager", venueId: venueB.id })
    expect(directory.staff.find((s) => s.id === chef.id)?.role).toBe("staff")
    expect(directory.staff.some((s) => s.id === admin.id)).toBe(false)

    const account = await getStaffAccount(ctxFor(admin.client), person.id)
    expect(account).toMatchObject({
      ok: true,
      staff: { id: person.id, role: "manager" },
    })
    expect(
      await getStaffAccount(ctxFor(admin.client), admin2.id)
    ).toMatchObject({ ok: false, code: "not_found" })
  })

  it("lists only manager accounts without access as grant candidates", async () => {
    const actor = await actorFor(admin)
    const atB = await listGrantCandidates(actor, { venueId: venueB.id })
    if (!atB.ok) throw new Error(atB.message)
    // The converted person already has access at B.
    expect(atB.people.map((p) => p.id)).not.toContain(person.id)
    const atA = await listGrantCandidates(actor, { venueId: venueA.id })
    if (!atA.ok) throw new Error(atA.message)
    // Staff accounts are never candidates.
    expect(atA.people.map((p) => p.id)).not.toContain(chef.id)

    // A staff account cannot be given access any more.
    expect(
      await grantVenueManager(actor, { staffId: chef.id, venueId: venueA.id })
    ).toMatchObject({ ok: false, code: "state_conflict" })
  })
})

describe("refusals", () => {
  it("only an active admin can convert", async () => {
    const target = await createIdentity(service, {
      label: "conv-refuse",
      role: "staff",
      venueId: venueA.id,
    })
    const input = () => ({
      requestId: key(),
      profileId: target.id,
      venueId: venueA.id,
      reason: "TEST",
    })
    expect(await convertToManager(ctxFor(chef.client), input())).toMatchObject({
      ok: false,
      code: "not_permitted",
    })
    expect(await convertToManager(ctxFor(anonClient()), input())).toMatchObject(
      { ok: false, code: "unauthenticated" }
    )
    expect((await profileOf(target.id)).role).toBe("staff")
  })

  it("refuses self, admins, the wrong direction, inactive accounts and venues", async () => {
    const ctx = ctxFor(admin.client)
    const target = await createIdentity(service, {
      label: "conv-edge",
      role: "staff",
      venueId: venueA.id,
    })
    const input = (profileId: string, venueId = venueA.id) => ({
      requestId: key(),
      profileId,
      venueId,
      reason: "TEST edge",
    })

    expect(await convertToManager(ctx, input(admin.id))).toMatchObject({
      ok: false,
      code: "not_permitted",
      message: "You can't change your own account type.",
    })
    expect(await convertToManager(ctx, input(admin2.id))).toMatchObject({
      ok: false,
      code: "not_found",
    })
    // A staff account is not a manager yet.
    expect(await convertToStaff(ctx, input(target.id))).toMatchObject({
      ok: false,
      code: "state_conflict",
      message: "This account is already a staff account. Reload the page.",
    })
    expect(
      await convertToManager(ctx, input(target.id, closed.id))
    ).toMatchObject({
      ok: false,
      code: "invalid_input",
      fieldErrors: { venueId: "This venue is inactive or no longer exists." },
    })
    expect(
      await convertToManager(ctx, { ...input(target.id), reason: "  " })
    ).toMatchObject({
      ok: false,
      code: "invalid_input",
      fieldErrors: { reason: "Enter a reason." },
    })
    expect(
      await convertToManager(ctx, { ...input(target.id), requestId: "x" })
    ).toMatchObject({ ok: false, code: "invalid_input" })

    await service
      .from("profiles")
      .update({ active: false })
      .eq("id", target.id)
      .throwOnError()
    expect(await convertToManager(ctx, input(target.id))).toMatchObject({
      ok: false,
      code: "state_conflict",
      message: "Only an active account can change type. Reactivate it first.",
    })
    expect(await profileOf(target.id)).toMatchObject({
      role: "staff",
      venue_id: venueA.id,
    })
    expect(await auditOf(target.id)).toEqual([])
  })
})

describe("return a venue manager account to staff", () => {
  it("ends venue access, assigns the venue and records the change", async () => {
    const ctx = ctxFor(admin.client)
    const person = await createIdentity(service, {
      label: "conv-back",
      role: "staff",
      venueId: venueA.id,
    })
    const up = await convertToManager(ctx, {
      requestId: key(),
      profileId: person.id,
      venueId: venueA.id,
      reason: "TEST cover",
    })
    expect(up).toMatchObject({ ok: true })
    expect(
      await convertToManager(ctx, {
        requestId: key(),
        profileId: person.id,
        venueId: venueA.id,
        reason: "TEST again",
      })
    ).toMatchObject({
      ok: false,
      code: "state_conflict",
      message:
        "This account is already a venue manager account. Reload the page.",
    })

    const down = await convertToStaff(ctx, {
      requestId: key(),
      profileId: person.id,
      venueId: venueB.id,
      reason: "TEST cover ended",
    })
    expect(down).toMatchObject({
      ok: true,
      role: "staff",
      venueId: venueB.id,
      grantId: null,
      replayed: false,
    })
    expect(await profileOf(person.id)).toMatchObject({
      role: "staff",
      venue_id: venueB.id,
    })
    const grants = await grantsOf(person.id)
    expect(grants.every((g) => g.revoked_at)).toBe(true)
    expect(grants.at(-1)?.revoke_kind).toBe("role_changed")

    const history = await listAccountRoleHistory(ctx, person.id)
    if (!history.ok) throw new Error(history.message)
    expect(history.changes.map((c) => [c.from, c.to, c.reason])).toEqual([
      ["manager", "staff", "TEST cover ended"],
      ["staff", "manager", "TEST cover"],
    ])
  })
})

describe("account tooling for manager accounts", () => {
  it("edits, deactivates and reactivates a manager account; access ends on deactivation", async () => {
    const ctx = ctxFor(admin.client)
    const person = await createIdentity(service, {
      label: "conv-tools",
      role: "staff",
      venueId: venueA.id,
    })
    expect(
      await convertToManager(ctx, {
        requestId: key(),
        profileId: person.id,
        venueId: venueA.id,
        reason: "TEST tools",
      })
    ).toMatchObject({ ok: true })

    expect(
      await updateStaffAccount(ctx, person.id, { jobTitle: "TEST Manager" })
    ).toMatchObject({ ok: true })
    expect(
      (
        await service
          .from("profiles")
          .select("job_title")
          .eq("id", person.id)
          .single()
      ).data?.job_title
    ).toBe("TEST Manager")

    expect(await setStaffActive(ctx, person.id, false)).toMatchObject({
      ok: true,
      status: "inactive",
    })
    const grants = await grantsOf(person.id)
    expect(grants.at(-1)).toMatchObject({ revoke_kind: "deactivated" })

    // The grant list shows the ended grant; the account is still a manager.
    const listed = await listManagerGrants(await actorFor(admin), {
      venueId: venueA.id,
      includeRevoked: true,
    })
    if (!listed.ok) throw new Error(listed.message)
    const own = listed.grants.filter((g) => g.staff.id === person.id)
    expect(own.length).toBeGreaterThan(0)
    expect(own.every((g) => !g.effective && !g.legacyStaffGrant)).toBe(true)

    expect(await setStaffActive(ctx, person.id, true)).toMatchObject({
      ok: true,
    })
    expect(await profileOf(person.id)).toMatchObject({
      role: "manager",
      active: true,
    })
    // An admin gives access again: allowed for a manager account.
    const regrant = await grantVenueManager(await actorFor(admin), {
      staffId: person.id,
      venueId: venueA.id,
    })
    expect(regrant).toMatchObject({ ok: true })
  })

  it("marks grants still held by staff accounts as legacy", async () => {
    const holder = await createIdentity(service, {
      label: "conv-legacy",
      role: "staff",
      venueId: venueB.id,
    })
    // Written as grant_venue_manager did before manager accounts existed.
    await service
      .from("venue_manager_grants")
      .insert({
        staff_id: holder.id,
        venue_id: venueB.id,
        granted_by: admin.id,
        grant_reason: "TEST legacy",
      })
      .throwOnError()
    const listed = await listManagerGrants(await actorFor(admin), {
      venueId: venueB.id,
    })
    if (!listed.ok) throw new Error(listed.message)
    const legacy = listed.grants.find((g) => g.staff.id === holder.id)
    // Transitional rule: still in effect, labelled as legacy.
    expect(legacy).toMatchObject({ effective: true, legacyStaffGrant: true })
    expect(
      listed.grants
        .filter((g) => g.staff.id !== holder.id)
        .every((g) => !g.legacyStaffGrant)
    ).toBe(true)
  })
})
