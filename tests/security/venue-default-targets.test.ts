// G-6 (docs/plans/goals-not-tasks.md, decisions 16 and 17; v0.5 rule 26): a
// venue default monthly photo target. Precedence is the person's own
// manager-set number, then the venue default, then Needs setup. Rollover
// copies only manager-set numbers. Preparation run again adds nothing.
import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { currentMonth, fails, makeManager, ok, psql } from "./coverage-fixtures"

const service = serviceClient()

type Rpc = (
  fn: string,
  args?: Record<string, unknown>
) => PromiseLike<{
  data: unknown
  error: { code: string; message: string; details?: string } | null
}>
const rpc =
  (who: TestIdentity): Rpc =>
  (fn, args) =>
    (who.client.rpc as unknown as Rpc).call(who.client, fn, args)

type Run = {
  status: string
  targets_copied: number
  targets_defaulted: number
  placeholders_created: number
}

let admin: TestIdentity
let staffer: TestIdentity
let venue: string
let bare: string
let ownNumber: TestIdentity
let tookDefault: TestIdentity
let fresh: TestIdentity
let unset: TestIdentity

const month = currentMonth()
const [year, mon] = month.split("-").map(Number)
const lastMonth = new Date(Date.UTC(year!, mon! - 2, 1))
  .toISOString()
  .slice(0, 10)

async function staff(label: string, venueId: string) {
  const who = await createIdentity(service, { label, role: "staff", venueId })
  await service.from("profiles").update({ department: "foh" }).eq("id", who.id)
  return who
}

/** A last-month row written as the system (no signed-in user). */
function lastMonthRow(
  staffId: string,
  venueId: string,
  count: number,
  source: string
) {
  psql(`insert into public.monthly_targets
    (staff_id, venue_id, period_month, target_count, due_on, source)
    values ('${staffId}', '${venueId}', '${lastMonth}', ${count},
      ('${lastMonth}'::date + interval '1 month')::date - 1, '${source}')`)
}

async function targetOf(staffId: string) {
  const { data } = await service
    .from("monthly_targets")
    .select("id, target_count, source, revision, copied_from_target_id")
    .eq("staff_id", staffId)
    .eq("period_month", month)
  expect(data!.length).toBeLessThanOrEqual(1)
  return data![0] ?? null
}

async function rowsAt(venueId: string) {
  const { data } = await service
    .from("monthly_targets")
    .select("id, revision")
    .eq("venue_id", venueId)
    .order("id")
  return data
}

async function prepare(): Promise<Run[]> {
  return (await ok(
    service.rpc("prepare_coverage_month_scheduled")
  )) as unknown as Run[]
}

beforeAll(async () => {
  admin = await createIdentity(service, { label: "vdt-admin", role: "admin" })
  venue = (await createVenue(service, "vdt-default")).id
  bare = (await createVenue(service, "vdt-bare")).id
  staffer = await staff("vdt-staffer", venue)
  ownNumber = await staff("vdt-own", venue)
  tookDefault = await staff("vdt-took-default", venue)
  unset = await staff("vdt-unset", bare)
  lastMonthRow(ownNumber.id, venue, 7, "manager")
  lastMonthRow(tookDefault.id, venue, 2, "venue_default")
})

describe("venue default target", () => {
  it("is refused to staff, and needs a known revision", async () => {
    await fails(
      rpc(staffer)("set_venue_default_target", {
        p_venue_id: venue,
        p_target_count: 5,
      }),
      "not_venue_manager",
      "42501"
    )
    await fails(
      rpc(staffer)("venue_default_target", { p_venue_id: venue }),
      "not_venue_manager",
      "42501"
    )
    await fails(
      rpc(admin)("set_venue_default_target", {
        p_venue_id: venue,
        p_target_count: 5,
        p_expected_revision: 3,
      }),
      "coverage_conflict",
      "40001"
    )
    await fails(
      rpc(admin)("set_venue_default_target", {
        p_venue_id: venue,
        p_target_count: 501,
      }),
      "invalid_target_count"
    )
  })

  it("gives each person their own number first, then the default", async () => {
    const [set] = (await ok(
      rpc(admin)("set_venue_default_target", {
        p_venue_id: venue,
        p_target_count: 5,
      })
    )) as { revision: number; applied: number }[]
    expect(set!.revision).toBe(1)
    // Rollover copies the manager-set 7, never last month's default of 2.
    expect(await targetOf(ownNumber.id)).toMatchObject({
      target_count: 7,
      source: "copied",
    })
    expect((await targetOf(ownNumber.id))!.copied_from_target_id).not.toBeNull()
    expect(await targetOf(tookDefault.id)).toMatchObject({
      target_count: 5,
      source: "venue_default",
    })
    expect(await targetOf(staffer.id)).toMatchObject({
      target_count: 5,
      source: "venue_default",
    })
  })

  it("gives a new starter the default without a manager doing anything", async () => {
    fresh = await staff("vdt-fresh", venue)
    expect(await targetOf(fresh.id)).toBeNull()
    const runs = await prepare()
    expect(runs[0]!.status).toBe("succeeded")
    expect(await targetOf(fresh.id)).toMatchObject({
      target_count: 5,
      source: "venue_default",
    })
    const [progress] = (await ok(
      rpc(admin)("coverage_staff_progress_v2", {
        p_venue_id: venue,
        p_staff_id: fresh.id,
      })
    )) as {
      target_count: number
      target_source: string
      needs_setup: boolean
    }[]
    expect(progress).toMatchObject({
      target_count: 5,
      target_source: "venue_default",
      needs_setup: false,
    })
  })

  it("leaves a venue with no default on Needs setup", async () => {
    await prepare()
    expect(await targetOf(unset.id)).toMatchObject({
      target_count: null,
      source: "placeholder",
    })
    const [progress] = (await ok(
      rpc(admin)("coverage_staff_progress_v2", {
        p_venue_id: bare,
        p_staff_id: unset.id,
      })
    )) as { needs_setup: boolean; setup_missing: string[] }[]
    expect(progress).toMatchObject({
      needs_setup: true,
      setup_missing: ["target"],
    })
  })

  it("creates no duplicates and changes nothing when preparation runs again", async () => {
    const before = [await rowsAt(venue), await rowsAt(bare)]
    const runs = await prepare()
    const again = await prepare()
    expect(runs[0]!.status).toBe("succeeded")
    expect(again[0]!.status).toBe("succeeded")
    expect([await rowsAt(venue), await rowsAt(bare)]).toEqual(before)
    const { count } = await service
      .from("monthly_targets")
      .select("*", { count: "exact", head: true })
      .eq("venue_id", venue)
      .eq("period_month", month)
    expect(count).toBe(4)
  })

  it("fills a placeholder when a default is set, and clears it back with a reason", async () => {
    const placeholder = await targetOf(unset.id)
    await ok(
      rpc(admin)("set_venue_default_target", {
        p_venue_id: bare,
        p_target_count: 4,
      })
    )
    expect(await targetOf(unset.id)).toMatchObject({
      id: placeholder!.id,
      target_count: 4,
      source: "venue_default",
      revision: placeholder!.revision + 1,
    })
    await fails(
      rpc(admin)("set_venue_default_target", {
        p_venue_id: bare,
        p_target_count: null,
        p_expected_revision: 1,
      }),
      "reason_required"
    )
    const [cleared] = (await ok(
      rpc(admin)("set_venue_default_target", {
        p_venue_id: bare,
        p_target_count: null,
        p_expected_revision: 1,
        p_reason: "TEST no default",
      })
    )) as { revision: number; target_count: number | null }[]
    expect(cleared).toMatchObject({ revision: 2, target_count: null })
    expect(await targetOf(unset.id)).toMatchObject({
      id: placeholder!.id,
      target_count: null,
      source: "placeholder",
    })
    // Insert-only: both rows are still there.
    expect(
      psql(
        `select count(*) from private.venue_default_photo_targets where venue_id = '${bare}'`
      )
    ).toBe("2")
  })

  it("keeps the default's history unchangeable", () => {
    expect(() =>
      psql(
        `update private.venue_default_photo_targets set target_count = 1 where venue_id = '${venue}'`
      )
    ).toThrow(/row_immutable/)
  })
})

describe("back to the venue default (review c, 5)", () => {
  let v: string
  let w: string
  let person: TestIdentity
  let wasReset: TestIdentity
  let mgr: TestIdentity
  let otherMgr: TestIdentity
  const twoMonthsAgo = new Date(Date.UTC(year!, mon! - 3, 1))
    .toISOString()
    .slice(0, 10)

  beforeAll(async () => {
    v = (await createVenue(service, "vdt-reset")).id
    w = (await createVenue(service, "vdt-reset-other")).id
    ;[person, wasReset, mgr, otherMgr] = await Promise.all([
      staff("vdt-reset-person", v),
      staff("vdt-reset-was", v),
      staff("vdt-reset-mgr", v),
      staff("vdt-reset-other-mgr", w),
    ])
    await makeManager(admin, mgr, v)
    await makeManager(admin, otherMgr, w)
    // Two months ago their own 9; last month a manager moved them back to
    // the default. Their 9 must not come back.
    psql(`insert into public.monthly_targets
      (staff_id, venue_id, period_month, target_count, due_on, source)
      values ('${wasReset.id}', '${v}', '${twoMonthsAgo}', 9,
        ('${twoMonthsAgo}'::date + interval '1 month')::date - 1, 'manager')`)
    lastMonthRow(wasReset.id, v, 4, "venue_default")
    await ok(
      rpc(admin)("set_venue_default_target", {
        p_venue_id: v,
        p_target_count: 4,
      })
    )
  })

  it("rollover stops at a month that took the default", async () => {
    expect(await targetOf(wasReset.id)).toMatchObject({
      target_count: 4,
      source: "venue_default",
    })
  })

  it("lets the venue's manager move someone back, with a reason and the current revision", async () => {
    const before = (await targetOf(person.id))!
    expect(before).toMatchObject({ target_count: 4, source: "venue_default" })
    await ok(
      mgr.client.rpc("set_monthly_target", {
        p_venue_id: v,
        p_staff_id: person.id,
        p_period_month: currentMonth(),
        p_target_count: 8,
        p_reason: "Full time now",
        p_expected_revision: before.revision,
      })
    )
    const own = (await targetOf(person.id))!
    expect(own).toMatchObject({ target_count: 8, source: "manager" })

    const call = (who: TestIdentity, over: Record<string, unknown> = {}) =>
      who.client.rpc("use_venue_default_target", {
        p_venue_id: v,
        p_staff_id: person.id,
        p_reason: "Back to part time",
        p_expected_revision: own.revision,
        ...over,
      })
    await fails(call(person), "not_venue_manager", "42501")
    await fails(call(otherMgr), "not_venue_manager", "42501")
    await fails(call(mgr, { p_reason: "" }), "reason_required")
    await fails(
      call(mgr, { p_expected_revision: own.revision + 5 }),
      "coverage_conflict",
      "40001"
    )
    expect(await targetOf(person.id)).toMatchObject({ target_count: 8 })

    const [row] = (await ok(call(mgr)))!
    expect(row).toMatchObject({ target_count: 4, source: "venue_default" })
    expect(await targetOf(person.id)).toMatchObject({
      target_count: 4,
      source: "venue_default",
      revision: own.revision + 1,
      copied_from_target_id: null,
    })
    // Again: nothing changes.
    const [again] = (await ok(
      call(mgr, { p_expected_revision: own.revision + 1 })
    ))!
    expect(again!.revision).toBe(own.revision + 1)
    const { count } = await service
      .from("coverage_audit_events")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", own.id)
      .eq("reason", "Back to part time")
    expect(count).toBe(1)
    // Delta review 3: the audit says what it was before.
    const { data: audit } = await service
      .from("coverage_audit_events")
      .select("before, after")
      .eq("entity_id", own.id)
      .eq("reason", "Back to part time")
      .single()
    expect(audit).toMatchObject({
      before: { target: 8, source: "manager" },
      after: { target: 4, source: "venue_default" },
    })
  })

  it("keeps someone on no number when the default is cleared after moving them to it (delta review 2)", async () => {
    // Last month their own 30; this month a manager moved them to the default.
    const ana = await staff("vdt-reset-ana", v)
    lastMonthRow(ana.id, v, 30, "manager")
    psql(
      `select private.apply_monthly_targets('${v}'::uuid, '${month}'::date, '${admin.id}'::uuid)`
    )
    const copied = (await targetOf(ana.id))!
    expect(copied).toMatchObject({ target_count: 30, source: "copied" })
    await ok(
      mgr.client.rpc("use_venue_default_target", {
        p_venue_id: v,
        p_staff_id: ana.id,
        p_reason: "Back to the default",
        p_expected_revision: copied.revision,
      })
    )
    expect(await targetOf(ana.id)).toMatchObject({
      target_count: 4,
      source: "venue_default",
    })

    // The manager clears the default: Ana is on no number, not her old 30.
    const [current] = (await ok(
      rpc(admin)("venue_default_target", { p_venue_id: v })
    )) as { revision: number }[]
    await ok(
      rpc(admin)("set_venue_default_target", {
        p_venue_id: v,
        p_target_count: null,
        p_reason: "No default for now",
        p_expected_revision: current!.revision,
      })
    )
    expect(await targetOf(ana.id)).toMatchObject({
      target_count: null,
      source: "placeholder",
    })

    // Next month's preparation doesn't bring the 30 back either.
    const next = new Date(Date.UTC(year!, mon!, 1)).toISOString().slice(0, 10)
    psql(
      `select private.apply_monthly_targets('${v}'::uuid, '${next}'::date, '${admin.id}'::uuid)`
    )
    const { data } = await service
      .from("monthly_targets")
      .select("target_count, source")
      .eq("staff_id", ana.id)
      .eq("period_month", next)
      .single()
    expect(data).toEqual({ target_count: null, source: "placeholder" })

    // Someone who keeps their own number still carries it into next month.
    const bob = await staff("vdt-reset-bob", v)
    lastMonthRow(bob.id, v, 12, "manager")
    psql(
      `select private.apply_monthly_targets('${v}'::uuid, '${month}'::date, '${admin.id}'::uuid)`
    )
    expect(await targetOf(bob.id)).toMatchObject({
      target_count: 12,
      source: "copied",
    })
    psql(
      `select private.apply_monthly_targets('${v}'::uuid, '${next}'::date, '${admin.id}'::uuid)`
    )
    const { data: kept } = await service
      .from("monthly_targets")
      .select("target_count, source")
      .eq("staff_id", bob.id)
      .eq("period_month", next)
      .single()
    expect(kept).toEqual({ target_count: 12, source: "copied" })
  })

  it("is refused when the venue has no default", async () => {
    const someone = await staff("vdt-reset-nodefault", w)
    psql(`insert into public.monthly_targets
      (staff_id, venue_id, period_month, target_count, due_on, source)
      values ('${someone.id}', '${w}', '${month}', 3,
        ('${month}'::date + interval '1 month')::date - 1, 'manager')`)
    const row = (await targetOf(someone.id))!
    await fails(
      otherMgr.client.rpc("use_venue_default_target", {
        p_venue_id: w,
        p_staff_id: someone.id,
        p_reason: "x",
        p_expected_revision: row.revision,
      }),
      "no_venue_default",
      "P0001"
    )
  })
})
