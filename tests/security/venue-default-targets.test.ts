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
import { currentMonth, fails, ok, psql } from "./coverage-fixtures"

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
