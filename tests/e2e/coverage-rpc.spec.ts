import { randomUUID } from "node:crypto"

import { expect, test } from "@playwright/test"

import { signIn, type Db } from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"
import {
  londonInstant,
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { provisioner, psql } from "./helpers/stack"
import { seedReadyAssets, type Person } from "./helpers/world"

/**
 * Independent acceptance probes of the coverage database layer (owner handoff
 * §6 and the contract decisions D1–D13). Every assertion is a call by a real
 * signed-in user through PostgREST, the path any client could take around the
 * app; the service role only provisions fixtures and reads counts back. No
 * browser is opened.
 */

type RpcError = { code: string; message: string; details?: string | null }
type RpcResult<T> = { data: T | null; error: RpcError | null }

async function ok<T>(call: PromiseLike<RpcResult<T>>): Promise<T> {
  const { data, error } = await call
  if (error) {
    throw new Error(`${error.message} (${error.code}) ${error.details ?? ""}`)
  }
  return data as T
}

async function refused(
  call: PromiseLike<RpcResult<unknown>>,
  message: string,
  code: string
): Promise<RpcError> {
  const { error } = await call
  expect(error, `expected ${message}`).not.toBeNull()
  expect({ message: error!.message, code: error!.code }).toEqual({
    message,
    code,
  })
  return error!
}

const key = () => `ws5-${randomUUID()}`
// The generated RPC types mark every argument non-null; SQL NULL is the
// documented value for "create" and "not set".
const none = null as never

function londonMonth(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get("year")}-${get("month")}-01`
}

function monthBefore(month: string): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y!, m! - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
}

const sqlUuid = (id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("not a uuid")
  return `'${id}'::uuid`
}

function reviewDecisions(itemId: string): number {
  return Number(
    psql(
      `select count(*) from public.coverage_review_events where item_id = ${sqlUuid(itemId)} and action in ('accepted', 'needs_another_photo')`
    )
  )
}

/** The UTC instant London midnight starts the "YYYY-MM-01" month. */
function monthStart(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return londonInstant(y!, m!, 1)
}

const secondsBefore = (instant: string, seconds: number) =>
  new Date(Date.parse(instant) - seconds * 1000)
    .toISOString()
    .replace(".000Z", "Z")

/**
 * Moves an item's submission time (fixture only: the RPC always stamps the DB
 * clock), keeping its stored London month consistent with the new instant.
 */
function setSubmittedAt(itemId: string, instant: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(instant)) {
    throw new Error("instant must be UTC ISO")
  }
  psql(`
    begin;
    set local session_replication_role = replica;
    update public.coverage_submission_items
    set submitted_at = '${instant}'::timestamptz,
      submitted_month = private.london_month('${instant}'::timestamptz)
    where id = ${sqlUuid(itemId)};
    commit;
  `)
}

test.describe("coverage database acceptance (WS5)", () => {
  let w: CoverageWorld
  let month: string

  test.beforeEach(async () => {
    w = await provisionCoverageWorld()
    month = londonMonth(new Date())
  })

  async function signedIn(...people: Person[]): Promise<Db[]> {
    const clients: Db[] = []
    for (const person of people) {
      clients.push(await signIn(provisioner(), person.email))
    }
    return clients
  }

  async function grantManager(admin: Db) {
    await ok(
      admin.rpc("grant_venue_manager", {
        p_staff_id: w.manager.id,
        p_venue_id: w.venue1.id,
      })
    )
  }

  async function createRequirement(manager: Db, title: string, target = 2) {
    const [row] = await ok(
      manager.rpc("save_coverage_requirement", {
        p_venue_id: w.venue1.id,
        p_requirement_id: none,
        p_expected_revision: none,
        p_kind: "venue_specific",
        p_title: title,
        p_guidance: none,
        p_photo_target: target,
        p_due_on: none,
        p_client_request_key: key(),
      })
    )
    return row!.requirement_id
  }

  async function monthly(
    db: Db,
    staff: Person,
    venueId = w.venue1.id,
    period = month
  ) {
    const rows = await ok(
      db.rpc("coverage_staff_progress", {
        p_venue_id: venueId,
        p_period_month: period,
        p_staff_id: staff.id,
      })
    )
    return rows.find((r) => r.staff_id === staff.id && r.venue_id === venueId)
  }

  async function requirement(db: Db, requirementId: string) {
    const rows = await ok(
      db.rpc("coverage_requirement_progress", { p_venue_id: w.venue1.id })
    )
    return rows.find((r) => r.requirement_id === requirementId)!
  }

  test("London months and month ends follow Europe/London across BST and GMT (AC-02, AC-30)", () => {
    const months: [string, string][] = [
      [londonInstant(2026, 9, 30, 23, 59, 59), "2026-09-01"],
      [londonInstant(2026, 10, 1), "2026-10-01"],
      // 01:30 happens twice on 25 Oct 2026: once in BST, once in GMT.
      ["2026-10-25T00:30:00Z", "2026-10-01"],
      ["2026-10-25T01:30:00Z", "2026-10-01"],
      [londonInstant(2026, 10, 31, 23, 59, 59), "2026-10-01"],
      [londonInstant(2026, 11, 1), "2026-11-01"],
      ["2027-03-28T00:59:59Z", "2027-03-01"],
      ["2027-03-28T01:00:00Z", "2027-03-01"],
      [londonInstant(2027, 3, 31, 23, 59, 59), "2027-03-01"],
      [londonInstant(2027, 4, 1), "2027-04-01"],
    ]
    // The instants the helper produced are the ones the cases are about.
    expect(months.map(([at]) => at)).toEqual([
      "2026-09-30T22:59:59Z",
      "2026-09-30T23:00:00Z",
      "2026-10-25T00:30:00Z",
      "2026-10-25T01:30:00Z",
      "2026-10-31T23:59:59Z",
      "2026-11-01T00:00:00Z",
      "2027-03-28T00:59:59Z",
      "2027-03-28T01:00:00Z",
      "2027-03-31T22:59:59Z",
      "2027-03-31T23:00:00Z",
    ])
    const values = months
      .map(([at], i) => `(${i}, '${at}'::timestamptz)`)
      .join(", ")
    const got = psql(
      `select string_agg(private.london_month(at)::text, ',' order by i) from (values ${values}) v (i, at)`
    )
    expect(got.split(",")).toEqual(months.map(([, m]) => m))

    const ends = psql(`
      select string_agg(to_char(private.london_month_end(m) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ',' order by m)
      from (values ('2026-09-01'::date), ('2026-10-01'::date), ('2027-03-01'::date)) v (m)
    `)
    expect(ends.split(",")).toEqual([
      "2026-09-30T23:00:00Z",
      "2026-11-01T00:00:00Z",
      "2027-03-31T23:00:00Z",
    ])
    expect(psql(`select private.current_london_month()::text`)).toBe(month)
  })

  test("only assignees submit to a requirement; monthly-only submissions count for the month only (AC-31, AC-34, D2, D3)", async () => {
    const [admin, manager, staffA, staffB] = await signedIn(
      w.admin,
      w.manager,
      w.staffA,
      w.staffB
    )
    await grantManager(admin)
    const req = await createRequirement(manager, "WS5 back bar shelf")
    await ok(
      manager.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: req,
        p_staff_ids: [w.staffA.id],
      })
    )
    const [a1, a2] = await seedImages(w.staffA, w.venue1, 2)
    const [b1] = await seedImages(w.staffB, w.venue1, 1)

    // Staff B is FOH at the same venue but not assigned: refused.
    await refused(
      staffB.rpc("submit_coverage_photos", {
        p_asset_ids: [b1!],
        p_requirement_id: req,
        p_client_request_key: key(),
      }),
      "requirement_not_assigned",
      "P0001"
    )
    const [aItem] = await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [a1!],
        p_requirement_id: req,
        p_client_request_key: key(),
      })
    )
    expect(aItem).toMatchObject({ state: "submitted", reused: false })
    // The same photo without a requirement: a monthly-only contribution.
    const [bItem] = await ok(
      staffB.rpc("submit_coverage_photos", {
        p_asset_ids: [b1!],
        p_client_request_key: key(),
      })
    )
    for (const item of [aItem!, bItem!]) {
      await ok(
        manager.rpc("review_coverage_item", {
          p_item_id: item.item_id,
          p_expected_revision: item.revision,
          p_decision: "accepted",
          p_client_request_key: key(),
        })
      )
    }

    expect(await requirement(manager, req)).toMatchObject({
      accepted_count: 1,
      assignee_ids: [w.staffA.id],
    })
    expect(await monthly(staffB, w.staffB)).toMatchObject({
      accepted_count: 1,
      needs_setup: true,
      setup_missing: ["target"],
      complete: false,
    })
    expect(await monthly(staffA, w.staffA)).toMatchObject({
      accepted_count: 1,
    })

    // Unassigned: the next submission to the requirement is refused.
    await ok(
      manager.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: req,
        p_staff_ids: [],
      })
    )
    await refused(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [a2!],
        p_requirement_id: req,
        p_client_request_key: key(),
      }),
      "requirement_not_assigned",
      "P0001"
    )
  })

  test("reviews: a stale revision loses, the same decision replays, a different decision is refused (AC-01, AC-09, D4)", async () => {
    const [admin, manager, staffA] = await signedIn(
      w.admin,
      w.manager,
      w.staffA
    )
    await grantManager(admin)
    const [asset] = await seedImages(w.staffA, w.venue1, 1)
    const [item] = await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [asset!],
        p_client_request_key: key(),
      })
    )
    const reviewers = [
      { db: manager, key: key() },
      { db: admin, key: key() },
    ]
    const results = await Promise.all(
      reviewers.map((r) =>
        r.db.rpc("review_coverage_item", {
          p_item_id: item!.item_id,
          p_expected_revision: item!.revision,
          p_decision: "accepted",
          p_client_request_key: r.key,
        })
      )
    )
    const won = results.findIndex((r) => !r.error)
    expect(won).toBeGreaterThanOrEqual(0)
    const lost = 1 - won
    expect(results[lost]!.error).toMatchObject({
      message: "coverage_conflict",
      code: "40001",
    })
    const current = item!.revision + 1
    expect(JSON.parse(results[lost]!.error!.details!)).toEqual({
      revision: current,
      state: "accepted",
    })
    expect(reviewDecisions(item!.item_id)).toBe(1)

    // The winner's retry (same request key) is a replay: no new event.
    const [replay] = await ok(
      reviewers[won]!.db.rpc("review_coverage_item", {
        p_item_id: item!.item_id,
        p_expected_revision: item!.revision,
        p_decision: "accepted",
        p_client_request_key: reviewers[won]!.key,
      })
    )
    expect(replay).toMatchObject({ replayed: true, revision: current })
    // The loser's retry is still stale.
    await refused(
      reviewers[lost]!.db.rpc("review_coverage_item", {
        p_item_id: item!.item_id,
        p_expected_revision: item!.revision,
        p_decision: "accepted",
        p_client_request_key: reviewers[lost]!.key,
      }),
      "coverage_conflict",
      "40001"
    )
    // Same decision at the current revision: a no-op.
    const [same] = await ok(
      admin.rpc("review_coverage_item", {
        p_item_id: item!.item_id,
        p_expected_revision: current,
        p_decision: "accepted",
      })
    )
    expect(same).toMatchObject({ replayed: true, revision: current })
    // A different decision: refused at the current revision, and a stale
    // revision is reported before the state.
    await refused(
      manager.rpc("review_coverage_item", {
        p_item_id: item!.item_id,
        p_expected_revision: current,
        p_decision: "needs_another_photo",
        p_reason: "WS5: different decision",
      }),
      "invalid_transition",
      "P0001"
    )
    await refused(
      manager.rpc("review_coverage_item", {
        p_item_id: item!.item_id,
        p_expected_revision: item!.revision,
        p_decision: "needs_another_photo",
        p_reason: "WS5: different decision",
      }),
      "coverage_conflict",
      "40001"
    )

    expect(reviewDecisions(item!.item_id)).toBe(1)
    expect(await monthly(staffA, w.staffA)).toMatchObject({
      accepted_count: 1,
      pending_count: 0,
    })
  })

  test("self-review is the author reviewing; an attached colleague photo is not, and earns no monthly credit (AC-08, AC-21, D1, D5)", async () => {
    const [admin, manager, staffB] = await signedIn(
      w.admin,
      w.manager,
      w.staffB
    )
    await grantManager(admin)
    const [own] = await seedImages(w.manager, w.venue1, 1)
    const [colleague] = await seedImages(w.staffB, w.venue1, 1)
    const [ownItem] = await ok(
      manager.rpc("submit_coverage_photos", {
        p_asset_ids: [own!],
        p_client_request_key: key(),
      })
    )
    const [ownDecision] = await ok(
      manager.rpc("review_coverage_item", {
        p_item_id: ownItem!.item_id,
        p_expected_revision: ownItem!.revision,
        p_decision: "accepted",
        p_client_request_key: key(),
      })
    )
    expect(ownDecision).toMatchObject({ state: "accepted", self_review: true })

    const req = await createRequirement(manager, "WS5 terrace", 1)
    const [attached] = await ok(
      manager.rpc("attach_coverage_evidence", {
        p_requirement_id: req,
        p_asset_ids: [colleague!],
        p_client_request_key: key(),
        p_accept: true,
      })
    )
    expect(attached).toMatchObject({ state: "accepted" })

    const items = await ok(
      admin.rpc("coverage_items_page", {
        p_venue_id: w.venue1.id,
        p_states: ["accepted"],
      })
    )
    const pick = ({
      origin,
      author_id,
      submitted_by,
      decided_by,
      self_review,
      monthly_eligible,
    }: (typeof items)[number]) => ({
      origin,
      author_id,
      submitted_by,
      decided_by,
      self_review,
      monthly_eligible,
    })
    expect(pick(items.find((i) => i.asset_id === own)!)).toEqual({
      origin: "submitted",
      author_id: w.manager.id,
      submitted_by: w.manager.id,
      decided_by: w.manager.id,
      self_review: true,
      monthly_eligible: true,
    })
    expect(pick(items.find((i) => i.asset_id === colleague)!)).toEqual({
      origin: "attached",
      author_id: w.staffB.id,
      submitted_by: w.manager.id,
      decided_by: w.manager.id,
      self_review: false,
      monthly_eligible: false,
    })
    expect(
      psql(
        `select string_agg(action || ':' || self_review::text || ':' || (actor_id = ${sqlUuid(w.manager.id)})::text, ',' order by created_at) from public.coverage_review_events where item_id = ${sqlUuid(attached!.item_id)}`
      )
    ).toMatch(/accepted:false:true/)

    expect(await monthly(staffB, w.staffB)).toMatchObject({ accepted_count: 0 })
    expect(await monthly(manager, w.manager)).toMatchObject({
      accepted_count: 1,
    })
    expect(await requirement(manager, req)).toMatchObject({
      accepted_count: 1,
      satisfied: true,
    })
  })

  test("concurrent monthly preparation makes one target each, copies same-venue targets only and adds template candidates once (AC-03, D9)", async () => {
    const [admin, manager] = await signedIn(w.admin, w.manager)
    await grantManager(admin)
    const previous = monthBefore(month)
    const reason = "WS5 fixture: last month's target"
    await ok(
      admin.rpc("set_monthly_target", {
        p_staff_id: w.staffA.id,
        p_venue_id: w.venue1.id,
        p_period_month: previous,
        p_target_count: 3,
        p_reason: reason,
      })
    )
    await ok(
      admin.rpc("set_monthly_target", {
        p_staff_id: w.staffC.id,
        p_venue_id: w.venue2.id,
        p_period_month: previous,
        p_target_count: 4,
        p_reason: reason,
      })
    )
    // Staff C moves to venue 1: their venue 2 target must not follow them.
    const moved = await admin
      .from("profiles")
      .update({ venue_id: w.venue1.id })
      .eq("id", w.staffC.id)
    if (moved.error) throw moved.error

    const venues = `(${sqlUuid(w.venue1.id)}, ${sqlUuid(w.venue2.id)})`
    const targetsSql = `
      select string_agg(p.display_name || '|' || t.venue_id::text || '|' || coalesce(t.target_count::text, '-') || '|' || t.source, ',' order by p.display_name, t.venue_id)
      from public.monthly_targets t join public.profiles p on p.id = t.staff_id
      where t.period_month = '${month}' and t.venue_id in ${venues}`
    expect(psql(targetsSql)).toBe("")

    const runs = await Promise.all([
      manager.rpc("prepare_coverage_month", { p_venue_id: w.venue1.id }),
      admin.rpc("prepare_coverage_month", {}),
      provisioner().rpc("prepare_coverage_month_scheduled"),
      manager.rpc("prepare_coverage_month", { p_venue_id: w.venue1.id }),
    ])
    for (const run of runs) {
      expect(run.error).toBeNull()
      expect(run.data!.map((r) => r.status)).toEqual(["succeeded"])
    }

    const v1 = w.venue1.id
    const expected = [
      [w.manager, `${v1}|-|placeholder`],
      [w.staffA, `${v1}|3|copied`],
      [w.staffB, `${v1}|-|placeholder`],
      [w.joiner, `${v1}|-|placeholder`],
      [w.staffC, `${v1}|-|placeholder`],
    ] as const
    expect(psql(targetsSql).split(",")).toEqual(
      [...expected]
        .sort(([a], [b]) => (a.name < b.name ? -1 : 1))
        .map(([p, rest]) => `${p.name}|${rest}`)
    )

    const templates = Number(
      psql(
        `select count(*) from public.coverage_amenity_templates where active`
      )
    )
    const facts = Number(
      psql(
        `select count(*) from public.coverage_amenity_templates where active and needs_fact`
      )
    )
    expect(templates).toBeGreaterThan(0)
    for (const venue of [w.venue1, w.venue2]) {
      const [rows, distinct, setup, factRows, unknown] = psql(`
        select count(*), count(distinct amenity_key), count(*) filter (where status = 'needs_setup'),
          (select count(*) from public.venue_amenity_facts f where f.venue_id = ${sqlUuid(venue.id)}),
          (select count(*) from public.venue_amenity_facts f where f.venue_id = ${sqlUuid(venue.id)} and f.presence = 'unknown')
        from public.coverage_requirements where venue_id = ${sqlUuid(venue.id)} and amenity_key is not null
      `)
        .split("|")
        .map(Number)
      expect({ rows, distinct, setup, factRows, unknown }, venue.name).toEqual({
        rows: templates,
        distinct: templates,
        setup: templates,
        factRows: facts,
        unknown: facts,
      })
    }

    // A later run finds everything in place and changes nothing.
    const [again] = await ok(
      manager.rpc("prepare_coverage_month", { p_venue_id: w.venue1.id })
    )
    expect(again).toMatchObject({
      status: "succeeded",
      targets_copied: 0,
      placeholders_created: 0,
      candidates_added: 0,
      already_present: 5,
    })
    // Setup is never complete: the joiner has no team and no target.
    expect(await monthly(manager, w.joiner)).toMatchObject({
      needs_setup: true,
      setup_missing: ["team", "target"],
      complete: false,
    })
  })

  test("videos, unfinished, other-venue, deleted and colleagues' photos cannot be submitted (AC-10, AC-20, D12)", async () => {
    const [staffA] = await signedIn(w.staffA)
    const [video] = await seedReadyAssets(
      w.staffA.id,
      w.venue1.id,
      1,
      "video",
      `ws5-video-${w.tag}`
    )
    const [unfinished] = await seedImages(w.staffA, w.venue1, 1, {
      state: "processing",
    })
    const [elsewhere] = await seedImages(w.staffA, w.venue2, 1)
    const [deleted] = await seedImages(w.staffA, w.venue1, 1)
    const [colleague] = await seedImages(w.staffB, w.venue1, 1)
    const tombstone = await provisioner()
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deleted!)
    if (tombstone.error) throw tombstone.error

    const submit = (asset: string) =>
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [asset],
        p_client_request_key: key(),
      })
    const cases: [string, string, string, string | null][] = [
      [video!, "evidence_not_eligible", "P0001", "not_image"],
      [unfinished!, "evidence_not_eligible", "P0001", "not_ready"],
      [elsewhere!, "evidence_not_eligible", "P0001", "other_venue"],
      [deleted!, "media_asset_not_found", "P0002", null],
      [colleague!, "media_asset_not_found", "P0002", null],
    ]
    for (const [asset, message, code, detail] of cases) {
      const error = await refused(submit(asset), message, code)
      if (detail) expect(error.details, message).toBe(detail)
    }
    expect(
      psql(
        `select count(*) from public.coverage_submission_items where author_id = ${sqlUuid(w.staffA.id)}`
      )
    ).toBe("0")
  })

  test("a venue manager has no reach into another venue (AC-06, AC-07)", async () => {
    const [admin, manager, staffC] = await signedIn(
      w.admin,
      w.manager,
      w.staffC
    )
    await grantManager(admin)
    const [cPhoto, cOther] = await seedImages(w.staffC, w.venue2, 2)
    const [cItem] = await ok(
      staffC.rpc("submit_coverage_photos", {
        p_asset_ids: [cPhoto!],
        p_client_request_key: key(),
      })
    )
    const req = await createRequirement(manager, "WS5 own venue only", 1)

    await refused(
      manager.rpc("review_coverage_item", {
        p_item_id: cItem!.item_id,
        p_expected_revision: cItem!.revision,
        p_decision: "accepted",
        p_client_request_key: key(),
      }),
      "coverage_item_not_found",
      "P0002"
    )
    await refused(
      manager.rpc("save_coverage_requirement", {
        p_venue_id: w.venue2.id,
        p_requirement_id: none,
        p_expected_revision: none,
        p_kind: "venue_specific",
        p_title: "WS5 not my venue",
        p_guidance: none,
        p_photo_target: 1,
        p_due_on: none,
        p_client_request_key: key(),
      }),
      "not_venue_manager",
      "42501"
    )
    await refused(
      manager.rpc("prepare_coverage_month", { p_venue_id: w.venue2.id }),
      "not_venue_manager",
      "42501"
    )
    await refused(
      manager.rpc("set_monthly_target", {
        p_staff_id: w.staffC.id,
        p_venue_id: w.venue2.id,
        p_period_month: month,
        p_target_count: 2,
      }),
      "not_venue_manager",
      "42501"
    )
    // Venue 2 evidence onto a venue 1 requirement: looks like a missing photo.
    await refused(
      manager.rpc("attach_coverage_evidence", {
        p_requirement_id: req,
        p_asset_ids: [cOther!],
        p_client_request_key: key(),
        p_accept: true,
      }),
      "media_asset_not_found",
      "P0002"
    )
    await refused(
      manager.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: req,
        p_staff_ids: [w.staffC.id],
      }),
      "staff_not_eligible",
      "P0001"
    )
    // Reads of venue 2 return nothing about it.
    const queue = await manager.rpc("coverage_items_page", {
      p_venue_id: w.venue2.id,
    })
    expect(queue.data ?? []).toEqual([])
    const roster = await ok(
      manager.rpc("coverage_staff_progress", {
        p_venue_id: w.venue2.id,
        p_period_month: month,
      })
    )
    expect(roster.filter((r) => r.staff_id === w.staffC.id)).toEqual([])
    // Nothing changed at venue 2.
    expect(
      psql(
        `select state from public.coverage_submission_items where id = ${sqlUuid(cItem!.item_id)}`
      )
    ).toBe("submitted")
  })

  test("duplicate submits and reviews never inflate credit; distinct photos meet the target (AC-01, AC-18)", async () => {
    const [admin, manager, staffA] = await signedIn(
      w.admin,
      w.manager,
      w.staffA
    )
    await grantManager(admin)
    await ok(
      manager.rpc("set_monthly_target", {
        p_staff_id: w.staffA.id,
        p_venue_id: w.venue1.id,
        p_period_month: month,
        p_target_count: 2,
      })
    )
    const [a1, a2] = await seedImages(w.staffA, w.venue1, 2)
    const submitKey = key()
    const submit = (assets: string[], requestKey: string) =>
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: assets,
        p_client_request_key: requestKey,
      })
    const first = await ok(submit([a1!, a2!], submitKey))
    const ids = (rows: { item_id: string }[]) =>
      rows.map((r) => r.item_id).sort()
    expect(ids(await ok(submit([a1!, a2!], submitKey)))).toEqual(ids(first))
    const [reused] = await ok(submit([a1!], key()))
    expect(reused).toMatchObject({
      item_id: first.find((r) => r.asset_id === a1)!.item_id,
      reused: true,
    })
    await refused(submit([a1!], submitKey), "idempotency_key_reused", "22023")

    for (const item of first) {
      const reviewKey = key()
      const accept = (revision: number, requestKey: string) =>
        manager.rpc("review_coverage_item", {
          p_item_id: item.item_id,
          p_expected_revision: revision,
          p_decision: "accepted",
          p_client_request_key: requestKey,
        })
      expect((await ok(accept(item.revision, reviewKey)))[0]).toMatchObject({
        replayed: false,
      })
      expect((await ok(accept(item.revision, reviewKey)))[0]).toMatchObject({
        replayed: true,
      })
      expect((await ok(accept(item.revision + 1, key())))[0]).toMatchObject({
        replayed: true,
      })
      expect(reviewDecisions(item.item_id)).toBe(1)
    }
    // Attaching a live monthly-only photo moves that same item onto the
    // requirement (one month credit, one requirement); a second requirement
    // cannot take it as well.
    const a1Item = first.find((r) => r.asset_id === a1)!.item_id
    const req = await createRequirement(manager, "WS5 no double count", 1)
    const [relinked] = await ok(
      manager.rpc("attach_coverage_evidence", {
        p_requirement_id: req,
        p_asset_ids: [a1!],
        p_client_request_key: key(),
        p_accept: true,
      })
    )
    expect(relinked).toMatchObject({ item_id: a1Item, state: "accepted" })
    const other = await createRequirement(manager, "WS5 second home", 1)
    await refused(
      manager.rpc("attach_coverage_evidence", {
        p_requirement_id: other,
        p_asset_ids: [a1!],
        p_client_request_key: key(),
        p_accept: true,
      }),
      "asset_already_submitted",
      "P0001"
    )
    expect(reviewDecisions(a1Item)).toBe(1)
    expect(await requirement(manager, req)).toMatchObject({
      accepted_count: 1,
    })
    expect(await requirement(manager, other)).toMatchObject({
      accepted_count: 0,
    })

    expect(
      psql(
        `select count(*) from public.coverage_submission_items where author_id = ${sqlUuid(w.staffA.id)}`
      )
    ).toBe("2")
    expect(await monthly(staffA, w.staffA)).toMatchObject({
      target_count: 2,
      accepted_count: 2,
      pending_count: 0,
      needs_setup: false,
      complete: true,
    })
  })

  test("upload and submission must share the London month; a late review credits the submission month (AC-02, AC-05)", async () => {
    const [admin, manager, staffA] = await signedIn(
      w.admin,
      w.manager,
      w.staffA
    )
    await grantManager(admin)
    const req = await createRequirement(manager, "WS5 month edge", 3)
    await ok(
      manager.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: req,
        p_staff_ids: [w.staffA.id],
      })
    )
    const previous = monthBefore(month)
    const start = monthStart(month)
    const justBefore = secondsBefore(start, 1)
    const [beforeEdge] = await seedImages(w.staffA, w.venue1, 1, {
      uploadedAt: justBefore,
    })
    const [atEdge] = await seedImages(w.staffA, w.venue1, 1, {
      uploadedAt: start,
    })
    const [lastMonth] = await seedImages(w.staffA, w.venue1, 1, {
      uploadedAt: secondsBefore(start, 15 * 24 * 3600),
    })
    const submitted = await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [beforeEdge!, atEdge!, lastMonth!],
        p_requirement_id: req,
        p_client_request_key: key(),
      })
    )
    const itemFor = (asset: string) =>
      submitted.find((r) => r.asset_id === asset)!
    // Submitted in the last second of the previous London month, reviewed now.
    setSubmittedAt(itemFor(lastMonth!).item_id, justBefore)
    for (const item of submitted) {
      await ok(
        manager.rpc("review_coverage_item", {
          p_item_id: item.item_id,
          p_expected_revision: item.revision,
          p_decision: "accepted",
          p_client_request_key: key(),
        })
      )
    }

    expect(await monthly(staffA, w.staffA)).toMatchObject({
      accepted_count: 1,
      late_accepted_count: 0,
    })
    expect(
      await monthly(staffA, w.staffA, w.venue1.id, previous)
    ).toMatchObject({ accepted_count: 1, late_accepted_count: 1 })
    const items = await ok(
      manager.rpc("coverage_items_page", {
        p_venue_id: w.venue1.id,
        p_requirement_id: req,
        p_states: ["accepted"],
      })
    )
    const eligible = (asset: string) =>
      items.find((i) => i.asset_id === asset)!.monthly_eligible
    expect({
      beforeEdge: eligible(beforeEdge!),
      atEdge: eligible(atEdge!),
      lastMonth: eligible(lastMonth!),
    }).toEqual({ beforeEdge: false, atEdge: true, lastMonth: true })
    // Coverage counts every accepted photo, whatever its month.
    expect(await requirement(manager, req)).toMatchObject({
      accepted_count: 3,
      satisfied: true,
    })
  })

  test("deleted evidence reopens coverage and drops current credit; past credit and history stay (AC-10)", async () => {
    const [admin, manager, staffA] = await signedIn(
      w.admin,
      w.manager,
      w.staffA
    )
    await grantManager(admin)
    const req = await createRequirement(manager, "WS5 deleted evidence", 2)
    await ok(
      manager.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: req,
        p_staff_ids: [w.staffA.id],
      })
    )
    const previous = monthBefore(month)
    const start = monthStart(month)
    const [current] = await seedImages(w.staffA, w.venue1, 1)
    const [past] = await seedImages(w.staffA, w.venue1, 1, {
      uploadedAt: secondsBefore(start, 10 * 24 * 3600),
    })
    const [pending] = await seedImages(w.staffA, w.venue1, 1)
    const submitted = await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [current!, past!, pending!],
        p_requirement_id: req,
        p_client_request_key: key(),
      })
    )
    const itemFor = (asset: string) =>
      submitted.find((r) => r.asset_id === asset)!
    setSubmittedAt(
      itemFor(past!).item_id,
      secondsBefore(start, 10 * 24 * 3600 - 60)
    )
    for (const asset of [current!, past!]) {
      await ok(
        manager.rpc("review_coverage_item", {
          p_item_id: itemFor(asset).item_id,
          p_expected_revision: itemFor(asset).revision,
          p_decision: "accepted",
          p_client_request_key: key(),
        })
      )
    }
    expect(await requirement(manager, req)).toMatchObject({
      accepted_count: 2,
      satisfied: true,
    })

    // The author deletes all three photos through the normal own-delete call.
    for (const asset of [current!, past!, pending!]) {
      await ok(staffA.rpc("delete_media_asset", { p_asset_id: asset }))
    }
    expect(await requirement(manager, req)).toMatchObject({
      accepted_count: 0,
      evidence_removed_count: 2,
      satisfied: false,
    })
    expect(await monthly(staffA, w.staffA)).toMatchObject({
      accepted_count: 0,
    })
    // Deleted after its month ended: the past month keeps the credit.
    expect(
      await monthly(staffA, w.staffA, w.venue1.id, previous)
    ).toMatchObject({ accepted_count: 1, evidence_removed_count: 1 })
    // A pending photo deleted before review cannot be accepted.
    const refusedAccept = await refused(
      manager.rpc("review_coverage_item", {
        p_item_id: itemFor(pending!).item_id,
        p_expected_revision: itemFor(pending!).revision,
        p_decision: "accepted",
        p_client_request_key: key(),
      }),
      "evidence_not_eligible",
      "P0001"
    )
    expect(refusedAccept.details).toBe("evidence_removed")
    // History stays for reviewers: the decided items are still listed.
    const history = await ok(
      manager.rpc("coverage_items_page", {
        p_venue_id: w.venue1.id,
        p_requirement_id: req,
        p_states: ["accepted"],
      })
    )
    expect(
      Object.fromEntries(history.map((i) => [i.asset_id, i.evidence_available]))
    ).toEqual({ [current!]: false, [past!]: false })
  })

  test("revoke, transfer and deactivation end a manager's reach in their existing session (AC-07, D10)", async () => {
    const [admin, manager, staffA] = await signedIn(
      w.admin,
      w.manager,
      w.staffA
    )
    const [asset] = await seedImages(w.staffA, w.venue1, 1)
    const [item] = await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [asset!],
        p_client_request_key: key(),
      })
    )
    const grant = () =>
      ok(
        admin.rpc("grant_venue_manager", {
          p_staff_id: w.manager.id,
          p_venue_id: w.venue1.id,
        })
      )
    const prepare = (venueId = w.venue1.id) =>
      manager.rpc("prepare_coverage_month", { p_venue_id: venueId })
    const review = () =>
      manager.rpc("review_coverage_item", {
        p_item_id: item!.item_id,
        p_expected_revision: item!.revision,
        p_decision: "accepted",
        p_client_request_key: key(),
      })
    const revokeKind = (grantId: string) =>
      psql(
        `select coalesce(revoke_kind, 'open') from public.venue_manager_grants where id = ${sqlUuid(grantId)}`
      )
    const moveManager = async (venueId: string) => {
      const moved = await admin
        .from("profiles")
        .update({ venue_id: venueId })
        .eq("id", w.manager.id)
      if (moved.error) throw moved.error
    }

    const first = await grant()
    expect((await prepare()).error).toBeNull()
    await ok(
      admin.rpc("revoke_venue_manager", {
        p_grant_id: first,
        p_reason: "WS5: revoke check",
      })
    )
    expect(revokeKind(first)).toBe("revoked")
    await refused(prepare(), "not_venue_manager", "42501")
    await refused(review(), "coverage_item_not_found", "P0002")

    const second = await grant()
    expect(second).not.toBe(first)
    expect((await prepare()).error).toBeNull()
    await moveManager(w.venue2.id)
    expect(revokeKind(second)).toBe("venue_changed")
    await refused(prepare(), "not_venue_manager", "42501")
    // A transfer never grants the destination venue.
    await refused(prepare(w.venue2.id), "not_venue_manager", "42501")
    // Moving back does not restore the grant.
    await moveManager(w.venue1.id)
    await refused(prepare(), "not_venue_manager", "42501")
    await refused(review(), "coverage_item_not_found", "P0002")

    const third = await grant()
    expect((await prepare()).error).toBeNull()
    const deactivated = await admin
      .from("profiles")
      .update({ active: false })
      .eq("id", w.manager.id)
    if (deactivated.error) throw deactivated.error
    expect(revokeKind(third)).toBe("deactivated")
    expect((await prepare()).error?.code).toBe("42501")
    expect((await review()).error?.code).toMatch(/^(42501|P0002)$/)

    expect(
      psql(
        `select state || ':' || revision from public.coverage_submission_items where id = ${sqlUuid(item!.item_id)}`
      )
    ).toBe(`submitted:${item!.revision}`)
  })

  test("staff and managers cannot use operations they do not hold (R-S5, AC-28)", async () => {
    const [admin, manager, staffA] = await signedIn(
      w.admin,
      w.manager,
      w.staffA
    )
    await grantManager(admin)
    const [asset] = await seedImages(w.staffA, w.venue1, 1)
    const [item] = await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [asset!],
        p_client_request_key: key(),
      })
    )
    // Staff reviewing their own photo, setting targets or preparing the venue.
    await refused(
      staffA.rpc("review_coverage_item", {
        p_item_id: item!.item_id,
        p_expected_revision: item!.revision,
        p_decision: "accepted",
        p_client_request_key: key(),
      }),
      "coverage_item_not_found",
      "P0002"
    )
    await refused(
      staffA.rpc("set_monthly_target", {
        p_staff_id: w.staffA.id,
        p_venue_id: w.venue1.id,
        p_period_month: month,
        p_target_count: 1,
      }),
      "not_venue_manager",
      "42501"
    )
    await refused(
      staffA.rpc("prepare_coverage_month", { p_venue_id: w.venue1.id }),
      "not_venue_manager",
      "42501"
    )
    // Granting is admin-only, for managers and staff alike.
    for (const call of [
      manager.rpc("grant_venue_manager", {
        p_staff_id: w.staffB.id,
        p_venue_id: w.venue1.id,
      }),
      staffA.rpc("grant_venue_manager", {
        p_staff_id: w.staffA.id,
        p_venue_id: w.venue1.id,
      }),
    ]) {
      expect((await call).error?.code).toBe("42501")
    }
    // A past month is an admin correction only.
    await refused(
      manager.rpc("set_monthly_target", {
        p_staff_id: w.staffA.id,
        p_venue_id: w.venue1.id,
        p_period_month: monthBefore(month),
        p_target_count: 1,
        p_reason: "WS5: manager past correction",
      }),
      "historical_admin_only",
      "42501"
    )
    expect(
      psql(
        `select state from public.coverage_submission_items where id = ${sqlUuid(item!.item_id)}`
      )
    ).toBe("submitted")
    expect(
      psql(
        `select count(*) from public.venue_manager_grants where staff_id in (${sqlUuid(w.staffA.id)}, ${sqlUuid(w.staffB.id)})`
      )
    ).toBe("0")
  })

  test("removed capabilities stay removed: no withdraw, relink or candidate RPC, no withdrawn state; candidates only through preparation (schema v5)", async () => {
    const [admin, manager, staffA] = await signedIn(
      w.admin,
      w.manager,
      w.staffA
    )
    await grantManager(admin)
    const [asset] = await seedImages(w.staffA, w.venue1, 1)
    const [item] = await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [asset!],
        p_client_request_key: key(),
      })
    )
    const req = await createRequirement(manager, "WS5 relink target", 1)
    const env = getLocalSupabaseEnv()
    // Raw HTTP, not the typed client: the generated types no longer list these.
    const rawRpc = async (db: Db, fn: string, body: object) => {
      const { data } = await db.auth.getSession()
      const res = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: env.publishableKey,
          authorization: `Bearer ${data.session!.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      })
      return { status: res.status, body: (await res.json()) as RpcError }
    }
    const callers = { staff: staffA, manager }

    const removed: [string, object][] = [
      [
        "withdraw_coverage_item",
        { p_item_id: item!.item_id, p_expected_revision: item!.revision },
      ],
      [
        "relink_coverage_item",
        {
          p_item_id: item!.item_id,
          p_expected_revision: item!.revision,
          p_requirement_id: req,
          p_reason: "WS5: relink probe",
        },
      ],
    ]
    for (const [who, db] of Object.entries(callers)) {
      for (const [fn, body] of removed) {
        const res = await rawRpc(db, fn, body)
        expect(
          { status: res.status, code: res.body.code },
          `${who} ${fn}`
        ).toEqual({ status: 404, code: "PGRST202" })
      }
    }
    expect(
      psql(
        `select count(*) from pg_proc where proname in ('withdraw_coverage_item', 'relink_coverage_item')`
      )
    ).toBe("0")

    const candidates = () =>
      Number(
        psql(
          `select count(*) from public.coverage_requirements where venue_id = ${sqlUuid(w.venue1.id)} and amenity_key is not null`
        )
      )
    expect(candidates()).toBe(0)
    for (const [who, db] of Object.entries(callers)) {
      const res = await rawRpc(db, "ensure_venue_coverage_candidates", {
        p_venue_id: w.venue1.id,
      })
      expect(
        { status: res.status, code: res.body.code },
        `${who} ensure_venue_coverage_candidates`
      ).toEqual({ status: 404, code: "PGRST202" })
    }
    expect(
      psql(
        `select count(*) from pg_proc where proname = 'ensure_venue_coverage_candidates' and pronamespace = 'public'::regnamespace`
      )
    ).toBe("0")
    // The withdrawn state is gone from the item reads too (a manager read;
    // staff are refused this list for scope before the states are checked).
    await refused(
      manager.rpc("coverage_items_page", {
        p_venue_id: w.venue1.id,
        p_states: ["withdrawn"],
      }),
      "invalid_status",
      "22023"
    )
    expect(candidates()).toBe(0)
    // Preparation still adds the checklist.
    const [run] = await ok(
      manager.rpc("prepare_coverage_month", { p_venue_id: w.venue1.id })
    )
    const templates = Number(
      psql(
        `select count(*) from public.coverage_amenity_templates where active`
      )
    )
    expect(run).toMatchObject({
      status: "succeeded",
      candidates_added: templates,
    })
    expect(candidates()).toBe(templates)

    expect(
      psql(
        `select state || ':' || revision || ':' || (requirement_id is null)::text from public.coverage_submission_items where id = ${sqlUuid(item!.item_id)}`
      )
    ).toBe(`submitted:${item!.revision}:true`)
  })

  test("keyed create: same key and arguments replay the original, also after an edit; other payloads, bad keys, races and other users are handled (schema v5.1)", async () => {
    const [admin, manager] = await signedIn(w.admin, w.manager)
    await grantManager(admin)
    const create = (db: Db, title: string, requestKey: string, target = 2) =>
      db.rpc("save_coverage_requirement", {
        p_venue_id: w.venue1.id,
        p_requirement_id: none,
        p_expected_revision: none,
        p_kind: "venue_specific",
        p_title: title,
        p_guidance: none,
        p_photo_target: target,
        p_due_on: none,
        p_client_request_key: requestKey,
      })
    const k1 = key()
    const [created] = await ok(create(manager, "WS5 keyed", k1))
    // v5.1 (D-002): the DB says whether it replayed.
    expect(created).toMatchObject({ revision: 1, replayed: false })
    const replay = { ...created!, replayed: true }
    expect((await ok(create(manager, "WS5 keyed", k1)))[0]).toEqual(replay)
    // The hash is of the cleaned arguments: surrounding spaces still replay.
    expect((await ok(create(manager, "  WS5 keyed  ", k1)))[0]).toEqual(replay)

    // An edit (updates ignore the key) does not change what the key returns.
    const [edited] = await ok(
      manager.rpc("save_coverage_requirement", {
        p_venue_id: none,
        p_requirement_id: created!.requirement_id,
        p_expected_revision: 1,
        p_kind: "venue_specific",
        p_title: "WS5 keyed (edited)",
        p_guidance: none,
        p_photo_target: 3,
        p_due_on: none,
        p_client_request_key: key(),
      })
    )
    expect(edited!.revision).toBe(2)
    expect((await ok(create(manager, "WS5 keyed", k1)))[0]).toEqual(replay)

    await refused(
      create(manager, "WS5 keyed, other title", k1),
      "idempotency_key_reused",
      "22023"
    )
    await refused(
      create(manager, "WS5 keyed", k1, 5),
      "idempotency_key_reused",
      "22023"
    )
    for (const bad of ["short", "has spaces in it", "x".repeat(129)]) {
      await refused(
        create(manager, "WS5 bad key", bad),
        "invalid_request_key",
        "22023"
      )
    }

    // Three simultaneous creates with one key make one task.
    const k2 = key()
    const race = await Promise.all(
      [1, 2, 3].map(() => create(manager, "WS5 concurrent create", k2))
    )
    for (const r of race) expect(r.error).toBeNull()
    expect(new Set(race.map((r) => r.data![0]!.requirement_id)).size).toBe(1)
    expect(
      race.filter((r) => r.data![0]!.replayed === false),
      "answers reporting a new task"
    ).toHaveLength(1)
    expect(
      psql(
        `select count(*) from public.coverage_requirements where venue_id = ${sqlUuid(w.venue1.id)} and title = 'WS5 concurrent create'`
      )
    ).toBe("1")

    // Keys belong to their creator: the admin reusing the manager's key with
    // the same arguments gets a task of their own, not the manager's.
    const [adminCreated] = await ok(create(admin, "WS5 keyed", k1))
    expect(adminCreated!.requirement_id).not.toBe(created!.requirement_id)
    expect(adminCreated).toMatchObject({ revision: 1, replayed: false })
    expect(
      psql(
        `select string_agg(created_by::text, ',' order by created_at) from public.coverage_requirements where client_request_key = '${k1}'`
      ).split(",")
    ).toEqual([w.manager.id, w.admin.id])
    expect(
      psql(
        `select count(*) from public.coverage_audit_events where entity = 'requirement' and entity_id = ${sqlUuid(created!.requirement_id)} and action = 'created'`
      )
    ).toBe("1")
  })

  test("D-003: moving a replacement to another requirement drops its link, so the old request stays open (schema v5.1)", async () => {
    const [admin, manager, staffA] = await signedIn(
      w.admin,
      w.manager,
      w.staffA
    )
    await grantManager(admin)
    const r1 = await createRequirement(manager, "WS5 move from", 3)
    const r2 = await createRequirement(manager, "WS5 move to", 3)
    for (const req of [r1, r2]) {
      await ok(
        manager.rpc("set_coverage_requirement_assignees", {
          p_requirement_id: req,
          p_staff_ids: [w.staffA.id],
        })
      )
    }
    const photos = await seedImages(w.staffA, w.venue1, 7)
    const submit = async (
      asset: string,
      requirementId: string | null,
      replaces?: string
    ) =>
      (
        await ok(
          staffA.rpc("submit_coverage_photos", {
            p_asset_ids: [asset],
            p_requirement_id: requirementId ?? none,
            p_client_request_key: key(),
            p_replaces_item_id: replaces,
          })
        )
      )[0]!
    const decline = async (item: { item_id: string; revision: number }) =>
      ok(
        manager.rpc("review_coverage_item", {
          p_item_id: item.item_id,
          p_expected_revision: item.revision,
          p_decision: "needs_another_photo",
          p_reason: "WS5: another angle please",
          p_client_request_key: key(),
        })
      )
    const link = (itemId: string) =>
      psql(
        `select coalesce(requirement_id::text, 'monthly') || '|' || coalesce(replaces_item_id::text, '-') from public.coverage_submission_items where id = ${sqlUuid(itemId)}`
      )

    // Control: a replacement that stays on its task keeps its link.
    const kept = await submit(photos[0]!, r1)
    await decline(kept)
    const keptReplacement = await submit(photos[1]!, r1, kept.item_id)
    expect(link(keptReplacement.item_id)).toBe(`${r1}|${kept.item_id}`)

    // Task to task: resubmitting the pending replacement to another task.
    const declined = await submit(photos[2]!, r1)
    await decline(declined)
    const moved = await submit(photos[3]!, r1, declined.item_id)
    expect(link(moved.item_id)).toBe(`${r1}|${declined.item_id}`)
    const [relinked] = await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [photos[3]!],
        p_requirement_id: r2,
        p_client_request_key: key(),
      })
    )
    expect(relinked).toMatchObject({ item_id: moved.item_id })
    const results: Record<string, string> = {
      taskToTask: link(moved.item_id),
    }

    // Task to monthly-only.
    const declined2 = await submit(photos[4]!, r1)
    await decline(declined2)
    const toMonthly = await submit(photos[5]!, r1, declined2.item_id)
    await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [photos[5]!],
        p_client_request_key: key(),
      })
    )
    results.taskToMonthly = link(toMonthly.item_id)

    // Monthly-only to a task, moved by the manager's attach.
    const monthlyDeclined = await submit(photos[6]!, null)
    await decline(monthlyDeclined)
    const [extra] = await seedImages(w.staffA, w.venue1, 1)
    const monthlyReplacement = await submit(
      extra!,
      null,
      monthlyDeclined.item_id
    )
    expect(link(monthlyReplacement.item_id)).toBe(
      `monthly|${monthlyDeclined.item_id}`
    )
    await ok(
      manager.rpc("attach_coverage_evidence", {
        p_requirement_id: r2,
        p_asset_ids: [extra!],
        p_client_request_key: key(),
        p_accept: false,
      })
    )
    results.monthlyToTaskByAttach = link(monthlyReplacement.item_id)
    test.info().annotations.push({
      type: "D-003 links after moves",
      description: JSON.stringify(results),
    })

    expect(results).toEqual({
      taskToTask: `${r2}|-`,
      taskToMonthly: "monthly|-",
      monthlyToTaskByAttach: `${r2}|-`,
    })
    // The control is untouched by the moves.
    expect(link(keptReplacement.item_id)).toBe(`${r1}|${kept.item_id}`)
  })
})
