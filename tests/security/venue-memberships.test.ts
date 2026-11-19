// Per-venue memberships (S1-PEOPLE; spec §3.1, §3.3, §7 M5, §8 A6; FA-22).
// AC14: manager at A and staff at B has manager rights only at A.
// AC40: a manager's invite creates a staff-only scope at their own venue.
// AC34: removal from the last venue ends access; history and assets remain.
// Real signed-in identities throughout; the service role only builds fixtures
// and reads state back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  assign,
  createRequirement,
  fails,
  makeManager,
  ok,
  psql,
} from "./coverage-fixtures"

const service = serviceClient()
let venueA: string
let venueB: string
let venueC: string
let venueClosed: string
let admin: TestIdentity
let managerA: TestIdentity
let managerB: TestIdentity
let dual: TestIdentity
let staffB: TestIdentity
let staffA: TestIdentity
let inactiveManager: TestIdentity

const staff = (label: string, venueId: string) =>
  createIdentity(service, { label, role: "staff", venueId })

/** Can the caller manage the venue (the DB gate behind every manager read)? */
async function canManage(who: TestIdentity, venueId: string) {
  const { error } = await who.client.rpc("coverage_items_page", {
    p_venue_id: venueId,
  })
  if (error && error.message !== "not_venue_manager") throw error
  return error === null
}

async function openMemberships(profileId: string) {
  const { data, error } = await service
    .from("venue_memberships")
    .select("id, venue_id, role, source, granted_by")
    .eq("profile_id", profileId)
    .is("ended_at", null)
  if (error) throw error
  return data
}

async function profile(id: string) {
  const { data, error } = await service
    .from("profiles")
    .select("role, venue_id, active")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
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

/** An invitation the server would create: auth user marked, no profile. */
async function invitedUser(label: string, marked = true) {
  const { data, error } = await service.auth.admin.createUser({
    email: `it-${label}-${crypto.randomUUID().slice(0, 8)}@nabalens.test`,
    email_confirm: false,
    user_metadata: marked ? { nabalens_invite: true } : {},
  })
  if (error) throw error
  return data.user.id
}

function setRole(
  who: TestIdentity,
  profileId: string,
  venueId: string,
  role: "staff" | "manager",
  reason: string | null = "TEST role"
) {
  return who.client.rpc("admin_set_venue_membership", {
    p_profile_id: profileId,
    p_venue_id: venueId,
    p_role: role,
    p_reason: reason as string,
  })
}

function invite(
  who: { client: TestIdentity["client"] },
  userId: string,
  venueId: string
) {
  return who.client.rpc("manager_invite_staff", {
    p_user_id: userId,
    p_venue_id: venueId,
    p_display_name: "TEST Invitee",
    p_job_title: "Server",
  })
}

function remove(
  who: { client: TestIdentity["client"] },
  profileId: string,
  venueId: string,
  replacement: string | null = null
) {
  return who.client.rpc("remove_venue_member", {
    p_profile_id: profileId,
    p_venue_id: venueId,
    p_reason: "TEST left the venue",
    p_replacement_id: replacement as string,
  })
}

beforeAll(async () => {
  venueA = (await createVenue(service, "mem-a")).id
  venueB = (await createVenue(service, "mem-b")).id
  venueC = (await createVenue(service, "mem-c")).id
  venueClosed = (await createVenue(service, "mem-closed")).id
  admin = await createIdentity(service, { label: "mem-admin", role: "admin" })
  managerA = await staff("mem-mgr-a", venueA)
  await makeManager(admin, managerA, venueA)
  managerB = await staff("mem-mgr-b", venueB)
  await makeManager(admin, managerB, venueB)
  dual = await staff("mem-dual", venueB)
  staffB = await staff("mem-staff-b", venueB)
  staffA = await staff("mem-staff-a", venueA)
  inactiveManager = await staff("mem-mgr-off", venueA)
  await makeManager(admin, inactiveManager, venueA)
  // Two managers at A: the second is deactivated below.
  await ok(
    service
      .from("profiles")
      .update({ active: false })
      .eq("id", inactiveManager.id)
  )
})

describe("memberships follow the existing profile and grant model", () => {
  it("opens one membership per invited profile and per manager grant", async () => {
    expect(await openMemberships(staffB.id)).toEqual([
      expect.objectContaining({ venue_id: venueB, role: "staff" }),
    ])
    expect(await openMemberships(managerA.id)).toEqual([
      expect.objectContaining({ venue_id: venueA, role: "manager" }),
    ])
  })

  it("ends every membership when the account is deactivated", async () => {
    expect(await openMemberships(inactiveManager.id)).toEqual([])
  })

  it("keeps rows append-only for the service role and invisible to users", async () => {
    const { error } = await service
      .from("venue_memberships")
      .delete()
      .eq("profile_id", staffB.id)
    expect(error).not.toBeNull()
    const { data } = await staffB.client
      .from("venue_memberships" as never)
      .select("id")
    expect(data ?? []).toEqual([])
  })
})

describe("AC14: manager at A and staff at B", () => {
  beforeAll(async () => {
    await ok(setRole(admin, dual.id, venueA, "manager"))
  })

  it("lists both venues with their roles, active venue first", async () => {
    const rows = await ok(dual.client.rpc("my_venue_memberships"))
    expect(rows).toEqual([
      {
        venue_id: venueB,
        venue_name: expect.any(String),
        role: "staff",
        is_active_venue: true,
      },
      {
        venue_id: venueA,
        venue_name: expect.any(String),
        role: "manager",
        is_active_venue: false,
      },
    ])
  })

  it("has no manager rights while working at B, and never at B", async () => {
    expect(await canManage(dual, venueA)).toBe(false)
    expect(await canManage(dual, venueB)).toBe(false)
  })

  it("switching to A gives manager rights at A only; switching back keeps the grant", async () => {
    expect(
      await ok(dual.client.rpc("switch_active_venue", { p_venue_id: venueA }))
    ).toEqual([{ venue_id: venueA, role: "manager" }])
    expect(await profile(dual.id)).toMatchObject({
      role: "manager",
      venue_id: venueA,
    })
    expect(await canManage(dual, venueA)).toBe(true)
    expect(await canManage(dual, venueB)).toBe(false)

    await ok(dual.client.rpc("switch_active_venue", { p_venue_id: venueB }))
    expect(await profile(dual.id)).toMatchObject({
      role: "staff",
      venue_id: venueB,
    })
    expect(await canManage(dual, venueA)).toBe(false)
    expect((await openGrants(dual.id)).map((g) => g.venue_id)).toEqual([venueA])
    expect(await openMemberships(dual.id)).toHaveLength(2)
  })

  it("never grants access by switching (another venue, unknown, inactive)", async () => {
    await fails(
      dual.client.rpc("switch_active_venue", { p_venue_id: venueC }),
      "not_a_member",
      "42501"
    )
    await fails(
      dual.client.rpc("switch_active_venue", {
        p_venue_id: crypto.randomUUID(),
      }),
      "not_a_member"
    )
    await ok(setRole(admin, dual.id, venueClosed, "staff"))
    await ok(
      service.from("venues").update({ active: false }).eq("id", venueClosed)
    )
    await fails(
      dual.client.rpc("switch_active_venue", { p_venue_id: venueClosed }),
      "not_a_member"
    )
    expect(await profile(dual.id)).toMatchObject({ venue_id: venueB })
  })

  it("refuses an admin, an inactive account and anon", async () => {
    await fails(
      admin.client.rpc("switch_active_venue", { p_venue_id: venueA }),
      "admin_has_all_venues"
    )
    await fails(
      inactiveManager.client.rpc("switch_active_venue", { p_venue_id: venueA }),
      "not_active_user"
    )
    const { error } = await anonClient().rpc("switch_active_venue", {
      p_venue_id: venueA,
    })
    expect(error?.code).toBe("42501")
  })

  it("shows effective privileges per venue to admins, the person and the venue's manager", async () => {
    const rows = await ok(
      admin.client.rpc("person_venue_privileges", { p_profile_id: dual.id })
    )
    const byVenue = Object.fromEntries(rows.map((r) => [r.venue_id, r]))
    expect(byVenue[venueA]).toMatchObject({
      membership_role: "manager",
      effective_role: "manager",
      can_review: true,
      can_invite_staff: true,
      can_grant_roles: false,
    })
    expect(byVenue[venueB]).toMatchObject({
      membership_role: "staff",
      effective_role: "staff",
      is_active_venue: true,
      can_upload: true,
      can_review: false,
      can_invite_staff: false,
    })
    // Inactive venue: the membership is listed but grants nothing.
    expect(byVenue[venueClosed]).toMatchObject({
      effective_role: null,
      can_upload: false,
    })

    const own = await ok(
      dual.client.rpc("person_venue_privileges", { p_profile_id: dual.id })
    )
    expect(own).toHaveLength(3)
    // Manager at B sees only the B row; staff and another venue see nothing.
    const fromB = await ok(
      managerB.client.rpc("person_venue_privileges", { p_profile_id: dual.id })
    )
    expect(fromB.map((r) => r.venue_id)).toEqual([venueB])
    expect(
      await ok(
        staffB.client.rpc("person_venue_privileges", { p_profile_id: dual.id })
      )
    ).toEqual([])
    expect(
      await ok(
        managerA.client.rpc("person_venue_privileges", {
          p_profile_id: staffB.id,
        })
      )
    ).toEqual([])
    const adminRow = await ok(
      admin.client.rpc("person_venue_privileges", { p_profile_id: admin.id })
    )
    expect(adminRow).toEqual([
      expect.objectContaining({
        effective_role: "admin",
        can_grant_roles: true,
      }),
    ])
    await fails(
      inactiveManager.client.rpc("person_venue_privileges", {
        p_profile_id: dual.id,
      }),
      "not_active_user"
    )
    const { error } = await anonClient().rpc("person_venue_privileges", {
      p_profile_id: dual.id,
    })
    expect(error?.code).toBe("42501")
  })
})

describe("AC40: managers invite ordinary staff to their own venue only", () => {
  it("creates a staff account at the manager's venue from a marked invitation", async () => {
    const userId = await invitedUser("mem-new")
    const [row] = await ok(invite(managerA, userId, venueA))
    expect(row).toMatchObject({ profile_id: userId, outcome: "created" })
    expect(await profile(userId)).toEqual({
      role: "staff",
      venue_id: venueA,
      active: true,
    })
    expect(await openMemberships(userId)).toEqual([
      expect.objectContaining({
        venue_id: venueA,
        role: "staff",
        source: "manager_invite",
        granted_by: managerA.id,
      }),
    ])
  })

  it("adds an existing person as staff without touching their other venues", async () => {
    const [row] = await ok(invite(managerA, staffB.id, venueA))
    expect(row!.outcome).toBe("added")
    expect(await profile(staffB.id)).toMatchObject({
      role: "staff",
      venue_id: venueB,
    })
    const venues = (await openMemberships(staffB.id))
      .map((m) => `${m.venue_id}:${m.role}`)
      .sort()
    expect(venues).toEqual([`${venueA}:staff`, `${venueB}:staff`].sort())
    // Repeating is harmless and never downgrades a manager.
    expect((await ok(invite(managerA, staffB.id, venueA)))[0]!.outcome).toBe(
      "already_member"
    )
    expect((await ok(invite(managerB, dual.id, venueB)))[0]!.outcome).toBe(
      "already_member"
    )
  })

  it("refuses another venue, staff, an inactive manager, admins and anon", async () => {
    const userId = await invitedUser("mem-refused")
    await fails(invite(managerA, userId, venueB), "not_venue_manager", "42501")
    await fails(invite(staffA, userId, venueA), "not_venue_manager")
    await fails(invite(inactiveManager, userId, venueA), "not_venue_manager")
    await fails(invite(managerA, admin.id, venueA), "account_not_eligible")
    await fails(
      invite(managerA, inactiveManager.id, venueA),
      "account_inactive"
    )
    const unmarked = await invitedUser("mem-unmarked", false)
    await fails(invite(managerA, unmarked, venueA), "account_not_found")
    const { error } = await invite({ client: anonClient() }, userId, venueA)
    expect(error?.code).toBe("42501")
    expect(await profile(userId).catch(() => null)).toBeNull()
  })

  it("lets an admin add staff at any venue", async () => {
    const userId = await invitedUser("mem-admin-inv")
    expect((await ok(invite(admin, userId, venueC)))[0]!.outcome).toBe(
      "created"
    )
  })

  it("lists the team to the venue's manager and admins only", async () => {
    const team = await ok(
      managerA.client.rpc("venue_team", { p_venue_id: venueA })
    )
    const ids = team.map((t) => t.profile_id)
    expect(ids).toEqual(
      expect.arrayContaining([managerA.id, dual.id, staffB.id, staffA.id])
    )
    expect(team.find((t) => t.profile_id === staffB.id)).toMatchObject({
      membership_role: "staff",
      is_active_venue: false,
    })
    expect(
      (await ok(admin.client.rpc("venue_team", { p_venue_id: venueA }))).length
    ).toBe(team.length)
    await fails(
      managerA.client.rpc("venue_team", { p_venue_id: venueB }),
      "not_venue_manager"
    )
    await fails(
      staffA.client.rpc("venue_team", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    await fails(
      inactiveManager.client.rpc("venue_team", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    const { error } = await anonClient().rpc("venue_team", {
      p_venue_id: venueA,
    })
    expect(error?.code).toBe("42501")
  })
})

describe("removing people (M5, A6, AC34)", () => {
  it("a manager removes ordinary staff at their venue only; the other venue stays", async () => {
    await fails(remove(managerB, staffB.id, venueA), "not_venue_manager")
    const [row] = await ok(remove(managerA, staffB.id, venueA))
    expect(row).toMatchObject({ outcome: "removed", active_venue_id: venueB })
    expect(await profile(staffB.id)).toMatchObject({
      active: true,
      venue_id: venueB,
    })
    expect((await openMemberships(staffB.id)).map((m) => m.venue_id)).toEqual([
      venueB,
    ])
    await fails(remove(managerA, staffB.id, venueA), "not_a_member")
  })

  it("a manager cannot remove a manager, themself, or anyone at another venue", async () => {
    await fails(
      remove(managerA, dual.id, venueA),
      "not_ordinary_staff",
      "42501"
    )
    await fails(remove(managerA, managerA.id, venueA), "cannot_remove_self")
    await fails(remove(managerA, staffB.id, venueB), "not_venue_manager")
    await fails(remove(staffA, staffB.id, venueB), "not_venue_manager")
    await fails(remove(inactiveManager, staffA.id, venueA), "not_venue_manager")
    await fails(remove(managerA, admin.id, venueA), "not_a_member")
    const { error } = await remove({ client: anonClient() }, staffA.id, venueA)
    expect(error?.code).toBe("42501")
  })

  it("removing the active venue moves the person to their next venue", async () => {
    const mover = await staff("mem-mover", venueA)
    await ok(setRole(admin, mover.id, venueC, "staff"))
    const [row] = await ok(remove(managerA, mover.id, venueA))
    expect(row).toMatchObject({ outcome: "removed", active_venue_id: venueC })
    expect(await profile(mover.id)).toMatchObject({
      role: "staff",
      venue_id: venueC,
      active: true,
    })
  })

  it("removal from the last venue deactivates the account and keeps its history", async () => {
    const leaver = await staff("mem-leaver", venueA)
    const [row] = await ok(remove(managerA, leaver.id, venueA))
    expect(row).toMatchObject({ outcome: "deactivated", active_venue_id: null })
    expect(await profile(leaver.id)).toMatchObject({ active: false })
    const { data: history } = await service
      .from("venue_memberships")
      .select("end_kind, ended_by, end_reason")
      .eq("profile_id", leaver.id)
    expect(history).toEqual([
      {
        end_kind: "removed",
        ended_by: managerA.id,
        end_reason: "TEST left the venue",
      },
    ])
    // The deactivated person can no longer act anywhere.
    expect(
      await ok(
        leaver.client.rpc("my_onboarding_state", { p_notice_version: "v1" })
      )
    ).toEqual([])
  })

  it("hands open assignments to a colleague in the same step", async () => {
    const leaver = await staff("mem-handover", venueA)
    const colleague = await staff("mem-colleague", venueA)
    const requirement = await createRequirement(admin, venueA)
    await assign(admin, requirement, [leaver.id])
    const createRequest = (subject: string) =>
      ok(
        managerA.client.rpc("media_request_create", {
          p_type: "campaign",
          p_venue_id: venueA,
          p_subject: subject,
          p_brief: "TEST handover",
          p_intended_use: "public",
          p_assignee_id: leaver.id,
        })
      ) as Promise<{ id: string; revision: number }>
    const request = await createRequest("Open photos")
    const closed = await createRequest("Completed photos")
    await ok(
      managerA.client.rpc("media_request_close", {
        p_request_id: closed.id,
        p_revision: closed.revision,
        p_state: "completed",
      })
    )
    await fails(
      remove(managerA, leaver.id, venueA, staffB.id),
      "replacement_not_eligible"
    )
    const [row] = await ok(remove(managerA, leaver.id, venueA, colleague.id))
    expect(row!.reassigned).toEqual({
      coverageAssignments: 1,
      amenityChecks: 0,
      mediaRequests: 1,
    })
    const { data } = await service
      .from("coverage_requirement_assignees")
      .select("staff_id")
      .eq("requirement_id", requirement)
      .is("ended_at", null)
    expect(data).toEqual([{ staff_id: colleague.id }])
    expect(
      psql(`select assignee_id || '|' || revision
      from public.media_requests where id = '${request.id}'`)
    ).toBe(`${colleague.id}|${request.revision + 1}`)
    expect(
      psql(
        `select assignee_id from public.media_requests where id = '${closed.id}'`
      )
    ).toBe(leaver.id)
    const work = (await ok(colleague.client.rpc("my_media_requests", {}))) as {
      items: Array<{ id: string; forMe: boolean }>
    }
    expect(work.items).toContainEqual(
      expect.objectContaining({ id: request.id, forMe: true })
    )
    expect(
      psql(`select recipient_id || '|' || (resolved_at is not null)::text
      from public.notifications where subject_type = 'media_request' and subject_id = '${request.id}'
      order by id`).split("\n")
    ).toEqual([`${leaver.id}|true`, `${colleague.id}|false`])
    expect(
      psql(`select actor_id || '|' || reason || '|' || (detail ->> 'assigneeId')
      from public.media_request_events where request_id = '${request.id}' and kind = 'edited'`)
    ).toBe(`${managerA.id}|TEST left the venue|${colleague.id}`)
  })

  it("reassign_open_work: manager or admin of the venue only", async () => {
    const from = await staff("mem-from", venueA)
    const to = await staff("mem-to", venueA)
    const requirement = await createRequirement(admin, venueA)
    await assign(admin, requirement, [from.id])
    const args = {
      p_from_profile_id: from.id,
      p_to_profile_id: to.id,
      p_venue_id: venueA,
      p_reason: "TEST cover",
    }
    await fails(
      managerB.client.rpc("reassign_open_work", args),
      "not_venue_manager"
    )
    await fails(
      staffA.client.rpc("reassign_open_work", args),
      "not_venue_manager"
    )
    expect(await ok(managerA.client.rpc("reassign_open_work", args))).toEqual({
      coverageAssignments: 1,
      amenityChecks: 0,
      mediaRequests: 0,
    })
    const { error } = await anonClient().rpc("reassign_open_work", args)
    expect(error?.code).toBe("42501")
  })

  it("an admin removes a manager membership: the grant ends, other venues stay", async () => {
    const [row] = await ok(remove(admin, dual.id, venueA))
    expect(row!.outcome).toBe("removed")
    expect(await openGrants(dual.id)).toEqual([])
    expect(await canManage(dual, venueA)).toBe(false)
    expect(
      (await openMemberships(dual.id)).map((m) => m.venue_id).sort()
    ).toEqual([venueB, venueClosed].sort())
  })
})

describe("admin_set_venue_membership", () => {
  it("is admin only, never on oneself, with a reason for manager rights", async () => {
    const target = await staff("mem-set", venueA)
    await fails(
      setRole(managerA, target.id, venueA, "manager"),
      "not_active_admin",
      "42501"
    )
    await fails(
      setRole(target, target.id, venueA, "manager"),
      "not_active_admin"
    )
    await fails(
      setRole(admin, target.id, venueA, "manager", null),
      "reason_required"
    )
    await fails(setRole(admin, admin.id, venueA, "staff"), "cannot_change_self")
    await fails(
      setRole(admin, target.id, venueA, "owner" as "staff"),
      "invalid_role"
    )
    const { error } = await setRole(
      { client: anonClient() } as TestIdentity,
      target.id,
      venueA,
      "staff"
    )
    expect(error?.code).toBe("42501")
  })

  it("promotes at the active venue at once and demotes back to staff", async () => {
    const target = await staff("mem-promote", venueA)
    await ok(setRole(admin, target.id, venueA, "manager"))
    expect(await profile(target.id)).toMatchObject({
      role: "manager",
      venue_id: venueA,
    })
    expect(await canManage(target, venueA)).toBe(true)
    await ok(setRole(admin, target.id, venueA, "staff"))
    expect(await profile(target.id)).toMatchObject({
      role: "staff",
      venue_id: venueA,
    })
    expect(await canManage(target, venueA)).toBe(false)
    expect(await openGrants(target.id)).toEqual([])
  })
})

describe("admin roles and the last active admin", () => {
  it("grants and revokes the admin role with a reason, admins only", async () => {
    const target = await staff("mem-to-admin", venueA)
    const grant = (who: { client: TestIdentity["client"] }) =>
      who.client.rpc("admin_grant_admin", {
        p_profile_id: target.id,
        p_reason: "TEST owner",
      })
    await fails(grant(managerA), "not_active_admin", "42501")
    await fails(grant(target), "not_active_admin")
    const { error } = await grant({ client: anonClient() })
    expect(error?.code).toBe("42501")
    await ok(grant(admin))
    expect(await profile(target.id)).toMatchObject({ role: "admin" })
    expect(await openMemberships(target.id)).toEqual([])

    await fails(
      admin.client.rpc("admin_revoke_admin", {
        p_profile_id: admin.id,
        p_venue_id: venueA,
        p_reason: "x",
      }),
      "cannot_change_self"
    )
    await fails(
      managerA.client.rpc("admin_revoke_admin", {
        p_profile_id: target.id,
        p_venue_id: venueA,
        p_reason: "x",
      }),
      "not_active_admin"
    )
    await ok(
      admin.client.rpc("admin_revoke_admin", {
        p_profile_id: target.id,
        p_venue_id: venueB,
        p_reason: "TEST",
      })
    )
    expect(await profile(target.id)).toMatchObject({
      role: "staff",
      venue_id: venueB,
    })
    expect((await openMemberships(target.id)).map((m) => m.venue_id)).toEqual([
      venueB,
    ])
  })

  it("refuses to deactivate or demote the last active admin by any route", () => {
    expect(() =>
      psql(
        `begin; update public.profiles set active = false where role = 'admin'; rollback;`
      )
    ).toThrow(/last_active_admin/)
    expect(() =>
      psql(
        `begin; update public.profiles set role = 'staff', venue_id = '${venueA}' where role = 'admin'; rollback;`
      )
    ).toThrow(/last_active_admin/)
  })
})

describe("first sign-in notice", () => {
  it("records the accepted version once and reads venue and role", async () => {
    const first = await ok(
      staffA.client.rpc("acknowledge_contribution_notice", { p_version: "v1" })
    )
    const again = await ok(
      staffA.client.rpc("acknowledge_contribution_notice", { p_version: "v1" })
    )
    expect(again).toBe(first)
    const [state] = await ok(
      staffA.client.rpc("my_onboarding_state", { p_notice_version: "v1" })
    )
    expect(state).toMatchObject({
      role: "staff",
      venue_id: venueA,
      venue_count: 1,
    })
    expect(state!.notice_acknowledged_at).toBe(first)
    await fails(
      staffA.client.rpc("acknowledge_contribution_notice", {
        p_version: "Bad Version",
      }),
      "invalid_notice_version"
    )
    await fails(
      inactiveManager.client.rpc("acknowledge_contribution_notice", {
        p_version: "v1",
      }),
      "not_active_user"
    )
    const { error } = await anonClient().rpc(
      "acknowledge_contribution_notice",
      { p_version: "v1" }
    )
    expect(error?.code).toBe("42501")
  })
})
