// Coverage counting and lifecycle rules: Europe/London months, monthly
// targets, concurrent monthly preparation, submission eligibility and
// idempotency, monthly credit (distinct, month boundaries, late review,
// deletion timing), review conflicts and self-review. Real identities; the
// service role only back-dates fixtures.
import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  accept,
  assign,
  createRequirement,
  currentMonth,
  fails,
  legacyStaffGrant,
  insertAsset,
  insertSubmittedItem,
  itemRevision,
  lastDay,
  midMonth,
  monthOffset,
  ok,
  psql,
  requestKey,
  requirementProgress,
  review,
  staffProgress,
  submit,
} from "./coverage-fixtures"
import { reserve, reserveReady } from "./menus-fixtures"

const service = serviceClient()
let venue: string
let otherVenue: string
let admin: TestIdentity
let manager: TestIdentity

async function staff(
  label: string,
  venueId = venue,
  department: "foh" | "boh" | null = "boh"
) {
  const s = await createIdentity(service, { label, role: "staff", venueId })
  if (department) {
    const { error } = await service
      .from("profiles")
      .update({ department })
      .eq("id", s.id)
    if (error) throw error
  }
  return s
}

const londonStartUtc = (month: string) =>
  psql(
    `select to_char(private.london_month_start('${month}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
  )

const plusMinutes = (iso: string, minutes: number) =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()

async function progressOf(
  who: TestIdentity,
  staffId: string,
  month = currentMonth(),
  venueId = venue
) {
  const rows = await staffProgress(who, venueId, month)
  return rows.find((r) => r.staff_id === staffId)
}

beforeAll(async () => {
  venue = (await createVenue(service, "cov-rules")).id
  otherVenue = (await createVenue(service, "cov-rules-other")).id
  admin = await createIdentity(service, {
    label: "cov-rules-admin",
    role: "admin",
  })
  manager = await staff("cov-rules-mgr")
  await legacyStaffGrant(service, admin, manager.id, venue)
})

describe("Europe/London calendar", () => {
  it("assigns instants to London months across GMT and BST", () => {
    expect(
      psql(`select string_agg(m::text, ',' order by n) from (values
        (1, private.london_month('2026-10-31T23:30:00Z')),
        (2, private.london_month('2026-06-30T23:30:00Z')),
        (3, private.london_month('2026-03-31T23:30:00Z')),
        (4, private.london_month('2026-12-31T23:59:59Z')),
        (5, private.london_month('2027-01-01T00:00:00Z'))
      ) v(n, m)`)
    ).toBe("2026-10-01,2026-07-01,2026-04-01,2026-12-01,2027-01-01")
    expect(londonStartUtc("2026-07-01")).toBe("2026-06-30T23:00:00Z")
    expect(londonStartUtc("2026-11-01")).toBe("2026-11-01T00:00:00Z")
    expect(
      psql(
        `select to_char(private.london_month_end('2026-03-01') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI')`
      )
    ).toBe("2026-03-31T23:00")
  })
})

describe("monthly targets", () => {
  let person: TestIdentity

  beforeAll(async () => {
    person = await staff("cov-rules-target")
  })

  const set = (
    who: TestIdentity,
    args: {
      month?: string
      count?: number
      due?: string | null
      reason?: string | null
      revision?: number | null
      staffId?: string
    }
  ) =>
    who.client.rpc("set_monthly_target", {
      p_staff_id: args.staffId ?? person.id,
      p_venue_id: venue,
      p_period_month: args.month ?? currentMonth(),
      p_target_count: args.count ?? 3,
      p_due_on: (args.due ?? null) as string,
      p_reason: (args.reason ?? null) as string,
      p_expected_revision: (args.revision ?? null) as number,
    })

  it("are set by the venue manager, default to month end, and need a reason to change", async () => {
    const [created] = await ok(set(manager, { count: 3 }))
    expect(created!.revision).toBe(1)
    const { data: row } = await service
      .from("monthly_targets")
      .select("*")
      .eq("id", created!.target_id)
      .single()
    expect(row).toMatchObject({
      target_count: 3,
      source: "manager",
      due_on: lastDay(currentMonth()),
    })

    await fails(
      set(manager, { count: 4, revision: 1 }),
      "reason_required",
      "22023"
    )
    const [changed] = await ok(
      set(manager, { count: 4, revision: 1, reason: "TEST part-time change" })
    )
    expect(changed!.revision).toBe(2)

    const stale = await fails(
      set(manager, { count: 5, revision: 1, reason: "late" }),
      "coverage_conflict",
      "40001"
    )
    expect(JSON.parse(stale.details!)).toMatchObject({ revision: 2 })

    const [same] = await ok(set(manager, { count: 4, revision: 2 }))
    expect(same!.revision).toBe(2)
    const { data: audit } = await service
      .from("coverage_audit_events")
      .select("action, reason")
      .eq("entity_id", created!.target_id)
      .order("id")
    expect(audit).toEqual([
      { action: "created", reason: null },
      { action: "updated", reason: "TEST part-time change" },
    ])

    const earlier = `${currentMonth().slice(0, 8)}10`
    const [early] = await ok(
      set(manager, {
        count: 4,
        revision: 2,
        due: earlier,
        reason: "TEST earlier deadline",
      })
    )
    expect(early!.revision).toBe(3)
  })

  it("reject invalid counts, periods and due dates", async () => {
    await fails(
      set(manager, { count: 0, revision: 3 }),
      "invalid_target_count",
      "22023"
    )
    await fails(
      set(manager, { count: 501, revision: 3 }),
      "invalid_target_count"
    )
    await fails(
      set(manager, { month: `${currentMonth().slice(0, 8)}02` }),
      "invalid_period",
      "22023"
    )
    await fails(
      set(manager, { due: lastDay(monthOffset(1)), revision: 3, reason: "x" }),
      "invalid_due_date",
      "22023"
    )
  })

  it("cannot be set by staff, and past months are admin-only audited corrections", async () => {
    await fails(set(person, { count: 9 }), "not_venue_manager", "42501")
    const past = monthOffset(-1)
    await fails(
      set(manager, { month: past, count: 2 }),
      "historical_admin_only",
      "42501"
    )
    await fails(set(admin, { month: past, count: 2 }), "reason_required")
    const [corrected] = await ok(
      set(admin, { month: past, count: 2, reason: "TEST missed setup" })
    )
    const { data: row } = await service
      .from("monthly_targets")
      .select("source")
      .eq("id", corrected!.target_id)
      .single()
    expect(row!.source).toBe("admin_correction")
    const { data: audit } = await service
      .from("coverage_audit_events")
      .select("historical, actor_role")
      .eq("entity_id", corrected!.target_id)
      .single()
    expect(audit).toEqual({ historical: true, actor_role: "admin" })
    const [future] = await ok(set(manager, { month: monthOffset(1), count: 6 }))
    expect(future!.revision).toBe(1)
  })
})

describe("monthly preparation", () => {
  let prepVenue: string
  let prepManager: TestIdentity
  let copied: TestIdentity
  let fresh: TestIdentity
  let moved: TestIdentity
  let previousTarget: string

  beforeAll(async () => {
    prepVenue = (await createVenue(service, "cov-prep")).id
    const oldVenue = (await createVenue(service, "cov-prep-old")).id
    prepManager = await staff("cov-prep-mgr", prepVenue)
    await legacyStaffGrant(service, admin, prepManager.id, prepVenue)
    copied = await staff("cov-prep-copied", prepVenue)
    fresh = await staff("cov-prep-fresh", prepVenue, null)
    moved = await staff("cov-prep-moved", oldVenue)
    const previous = monthOffset(-1)
    const twoBack = monthOffset(-2)
    const rows = [
      {
        staff_id: copied.id,
        venue_id: prepVenue,
        period_month: twoBack,
        target_count: 7,
        due_on: lastDay(twoBack),
        source: "manager",
      },
      {
        staff_id: copied.id,
        venue_id: prepVenue,
        period_month: previous,
        target_count: 4,
        due_on: lastDay(previous),
        source: "manager",
      },
      {
        staff_id: moved.id,
        venue_id: oldVenue,
        period_month: previous,
        target_count: 9,
        due_on: lastDay(previous),
        source: "manager",
      },
    ]
    const { data, error } = await service
      .from("monthly_targets")
      .insert(rows)
      .select("id, staff_id, period_month")
    if (error) throw error
    previousTarget = data.find(
      (r) => r.staff_id === copied.id && r.period_month === previous
    )!.id
    const { error: moveError } = await service
      .from("profiles")
      .update({ venue_id: prepVenue })
      .eq("id", moved.id)
    if (moveError) throw moveError
  })

  it("is unique under concurrent scheduled and manual runs", async () => {
    const runs = await Promise.all([
      service.rpc("prepare_coverage_month_scheduled"),
      admin.client.rpc("prepare_coverage_month", { p_venue_id: prepVenue }),
      prepManager.client.rpc("prepare_coverage_month", {
        p_venue_id: prepVenue,
      }),
      admin.client.rpc("prepare_coverage_month", {}),
      service.rpc("prepare_coverage_month_scheduled"),
    ])
    for (const r of runs) {
      expect(r.error).toBeNull()
      expect(r.data![0]!.status).toBe("succeeded")
    }
    const { data: rows } = await service
      .from("monthly_targets")
      .select("staff_id, target_count, source, copied_from_target_id, due_on")
      .eq("venue_id", prepVenue)
      .eq("period_month", currentMonth())
    expect(rows!.length).toBe(4)
    const by = (id: string) => rows!.find((r) => r.staff_id === id)
    expect(by(copied.id)).toMatchObject({
      target_count: 4,
      source: "copied",
      copied_from_target_id: previousTarget,
      due_on: lastDay(currentMonth()),
    })
    expect(by(fresh.id)).toMatchObject({
      target_count: null,
      source: "placeholder",
    })
    // Never copied from the previous venue after a transfer.
    expect(by(moved.id)).toMatchObject({
      target_count: null,
      source: "placeholder",
    })
    expect(by(prepManager.id)).toMatchObject({ source: "placeholder" })

    const [again] = await ok(
      admin.client.rpc("prepare_coverage_month", { p_venue_id: prepVenue })
    )
    expect(again).toMatchObject({
      staff_considered: 4,
      targets_copied: 0,
      placeholders_created: 0,
      already_present: 4,
    })
  })

  it("flags missing setup for oversight and never counts it complete", async () => {
    const [status] = await ok(
      prepManager.client.rpc("coverage_preparation_status", {
        p_venue_id: prepVenue,
      })
    )
    expect(status).toMatchObject({
      period_month: currentMonth(),
      last_status: "succeeded",
      staff_without_target: 0,
      targets_needing_setup: 3,
    })
    const freshRow = await progressOf(
      prepManager,
      fresh.id,
      currentMonth(),
      prepVenue
    )
    expect(freshRow).toMatchObject({ needs_setup: true, complete: false })
    expect(freshRow!.setup_missing.sort()).toEqual(["target", "team"])
    const runs = await ok(
      prepManager.client.from("coverage_preparation_runs").select("id")
    )
    expect(runs.length).toBeGreaterThan(0)
  })

  it("is not callable on the scheduled path by signed-in users", async () => {
    const { error } = await admin.client.rpc("prepare_coverage_month_scheduled")
    expect(error).not.toBeNull()
    await fails(
      copied.client.rpc("prepare_coverage_month", { p_venue_id: prepVenue }),
      "not_venue_manager"
    )
    await fails(
      prepManager.client.rpc("prepare_coverage_month", {}),
      "not_active_admin"
    )
  })

  it("lets a manager set a placeholder without a reason", async () => {
    const [row] = await ok(
      prepManager.client.rpc("set_monthly_target", {
        p_staff_id: fresh.id,
        p_venue_id: prepVenue,
        p_period_month: currentMonth(),
        p_target_count: 2,
        p_expected_revision: 1,
      })
    )
    expect(row!.revision).toBe(2)
  })
})

describe("submission and monthly credit", () => {
  let author: TestIdentity
  let colleague: TestIdentity
  let requirement: string

  beforeAll(async () => {
    author = await staff("cov-rules-author")
    colleague = await staff("cov-rules-colleague")
    requirement = await createRequirement(manager, venue, {
      title: "TEST rules requirement",
      photoTarget: 5,
    })
    await assign(manager, requirement, [author.id, colleague.id])
    await ok(
      manager.client.rpc("set_monthly_target", {
        p_staff_id: author.id,
        p_venue_id: venue,
        p_period_month: currentMonth(),
        p_target_count: 2,
      })
    )
  })

  it("counts two distinct accepted photos once each; retries never add items", async () => {
    const one = await reserveReady(service, author)
    const two = await reserveReady(service, author)
    const key = requestKey()
    const first = await submit(author, [one.id, two.id], null, key)
    expect(first.map((r) => r.reused)).toEqual([false, false])
    const retry = await submit(author, [one.id, two.id], null, key)
    expect(retry.map((r) => r.item_id)).toEqual(first.map((r) => r.item_id))
    expect(retry.every((r) => r.reused)).toBe(true)
    await fails(
      author.client.rpc("submit_coverage_photos", {
        p_asset_ids: [one.id],
        p_client_request_key: key,
      }),
      "idempotency_key_reused",
      "22023"
    )

    for (const r of first) await accept(service, manager, r.item_id)
    // Re-submitting an accepted photo (new key, same requirement) reuses it.
    const resubmit = await submit(author, [one.id])
    expect(resubmit[0]).toMatchObject({
      item_id: first[0]!.item_id,
      reused: true,
      state: "accepted",
    })
    // Accepting again is a no-op.
    const { revision } = await itemRevision(service, first[0]!.item_id)
    const [replay] = await ok(
      review(manager, first[0]!.item_id, revision, "accepted")
    )
    expect(replay).toMatchObject({ replayed: true, revision })

    expect(await progressOf(manager, author.id)).toMatchObject({
      accepted_count: 2,
      target_count: 2,
      complete: true,
      overdue: false,
    })
    const { count } = await service
      .from("coverage_submission_items")
      .select("id", { count: "exact", head: true })
      .eq("author_id", author.id)
    expect(count).toBe(2)
  })

  it("rejects videos, unfinished uploads and other people's photos", async () => {
    const video = await reserveReady(service, author, "video")
    const e1 = await fails(
      author.client.rpc("submit_coverage_photos", {
        p_asset_ids: [video.id],
        p_client_request_key: requestKey(),
      }),
      "evidence_not_eligible"
    )
    expect(e1.details).toBe("not_image")
    const pending = await reserve(author)
    const e2 = await fails(
      author.client.rpc("submit_coverage_photos", {
        p_asset_ids: [pending.id],
        p_client_request_key: requestKey(),
      }),
      "evidence_not_eligible"
    )
    expect(e2.details).toBe("not_ready")
    const theirs = await reserveReady(service, colleague)
    await fails(
      author.client.rpc("submit_coverage_photos", {
        p_asset_ids: [theirs.id],
        p_client_request_key: requestKey(),
      }),
      "media_asset_not_found",
      "P0002"
    )
    await fails(
      author.client.rpc("submit_coverage_photos", {
        p_asset_ids: [],
        p_client_request_key: requestKey(),
      }),
      "invalid_asset_list"
    )
    await fails(
      author.client.rpc("submit_coverage_photos", {
        p_asset_ids: [theirs.id],
        p_client_request_key: "short",
      }),
      "invalid_request_key"
    )
  })

  it("gives older photos coverage but no monthly credit, and attached photos no credit", async () => {
    const old = await insertAsset(service, {
      uploader: author.id,
      venue,
      createdAt: midMonth(monthOffset(-1)),
    })
    const [oldItem] = await submit(author, [old.id], requirement)
    await accept(service, manager, oldItem!.item_id)
    const fresh = await reserveReady(service, colleague)
    const [attached] = await ok(
      manager.client.rpc("attach_coverage_evidence", {
        p_requirement_id: requirement,
        p_asset_ids: [fresh.id],
        p_client_request_key: requestKey(),
        p_accept: true,
      })
    )
    expect(attached).toMatchObject({ state: "accepted" })
    const { data: attachedRow } = await service
      .from("coverage_submission_items")
      .select("author_id, submitted_by, origin")
      .eq("id", attached!.item_id)
      .single()
    expect(attachedRow).toEqual({
      author_id: colleague.id,
      submitted_by: manager.id,
      origin: "attached",
    })

    expect(await progressOf(manager, author.id)).toMatchObject({
      accepted_count: 2,
    })
    expect(await progressOf(manager, colleague.id)).toMatchObject({
      accepted_count: 0,
    })
    const [req] = (await requirementProgress(manager, venue)).filter(
      (r) => r.requirement_id === requirement
    )
    expect(req).toMatchObject({
      accepted_count: 2,
      is_current: true,
      satisfied: false,
    })
  })

  it("requires a reason for another photo and links the replacement", async () => {
    const photo = await reserveReady(service, colleague)
    const [item] = await submit(colleague, [photo.id], requirement)
    await fails(
      review(manager, item!.item_id, 1, "needs_another_photo"),
      "reason_required",
      "22023"
    )
    const [decided] = await ok(
      review(manager, item!.item_id, 1, "needs_another_photo", "TEST blurry")
    )
    expect(decided).toMatchObject({
      state: "needs_another_photo",
      revision: 2,
      self_review: false,
    })
    expect(await progressOf(colleague, colleague.id)).toMatchObject({
      needs_another_photo_count: 1,
    })

    const replacement = await reserveReady(service, colleague)
    const [next] = await ok(
      colleague.client.rpc("submit_coverage_photos", {
        p_asset_ids: [replacement.id],
        p_requirement_id: requirement,
        p_client_request_key: requestKey(),
        p_replaces_item_id: item!.item_id,
      })
    )
    const { data: row } = await service
      .from("coverage_submission_items")
      .select("replaces_item_id")
      .eq("id", next!.item_id)
      .single()
    expect(row!.replaces_item_id).toBe(item!.item_id)
    expect(await progressOf(colleague, colleague.id)).toMatchObject({
      needs_another_photo_count: 0,
      pending_count: 1,
    })
  })
})

describe("review concurrency, retries and self-review", () => {
  let author: TestIdentity

  beforeAll(async () => {
    author = await staff("cov-rules-review")
  })

  it("detects concurrent stale reviews instead of overwriting", async () => {
    const photo = await reserveReady(service, author)
    const [item] = await submit(author, [photo.id])
    const [a, b] = await Promise.all([
      review(manager, item!.item_id, 1, "accepted"),
      review(admin, item!.item_id, 1, "needs_another_photo", "TEST other view"),
    ])
    const results = [a, b]
    expect(results.filter((r) => r.error === null)).toHaveLength(1)
    const loser = results.find((r) => r.error !== null)!
    expect(loser.error).toMatchObject({
      message: "coverage_conflict",
      code: "40001",
    })
    const { count } = await service
      .from("coverage_review_events")
      .select("id", { count: "exact", head: true })
      .eq("item_id", item!.item_id)
      .in("action", ["accepted", "needs_another_photo"])
    expect(count).toBe(1)
  })

  it("replays a retried review by request key without a second event", async () => {
    const photo = await reserveReady(service, author)
    const [item] = await submit(author, [photo.id])
    const key = requestKey()
    const [first] = await ok(
      review(manager, item!.item_id, 1, "accepted", null, key)
    )
    const [retry] = await ok(
      review(manager, item!.item_id, 1, "accepted", null, key)
    )
    expect(retry).toEqual({ ...first, replayed: true })
    const other = await reserveReady(service, author)
    const [otherItem] = await submit(author, [other.id])
    await fails(
      review(manager, otherItem!.item_id, 1, "accepted", null, key),
      "idempotency_key_reused"
    )
    const { count } = await service
      .from("coverage_review_events")
      .select("id", { count: "exact", head: true })
      .eq("client_request_key", key)
    expect(count).toBe(1)
  })

  it("allows a manager to accept their own photo and records it for admins", async () => {
    const own = await reserveReady(service, manager)
    const [item] = await submit(manager, [own.id])
    const [decided] = await ok(review(manager, item!.item_id, 1, "accepted"))
    expect(decided!.self_review).toBe(true)
    const { data: event } = await service
      .from("coverage_review_events")
      .select("self_review, actor_role")
      .eq("item_id", item!.item_id)
      .eq("action", "accepted")
      .single()
    expect(event).toEqual({ self_review: true, actor_role: "manager" })
    const overview = await ok(admin.client.rpc("coverage_group_overview", {}))
    expect(
      overview.find((v) => v.venue_id === venue)!.self_review_count
    ).toBeGreaterThanOrEqual(1)
    await fails(
      manager.client.rpc("coverage_group_overview", {}),
      "not_active_admin"
    )
    await fails(
      author.client.rpc("review_coverage_item", {
        p_item_id: item!.item_id,
        p_expected_revision: 2,
        p_decision: "needs_another_photo",
        p_reason: "x",
      }),
      "coverage_item_not_found"
    )
  })
})

describe("credit across month boundaries and deletion", () => {
  let author: TestIdentity
  const previous = monthOffset(-1)

  beforeAll(async () => {
    author = await staff("cov-rules-boundary")
    await ok(
      admin.client.rpc("set_monthly_target", {
        p_staff_id: author.id,
        p_venue_id: venue,
        p_period_month: previous,
        p_target_count: 2,
        p_reason: "TEST historical setup",
      })
    )
  })

  it("credits the submission month only when upload and submission share it, also after a late review", async () => {
    const start = londonStartUtc(previous)
    // Just inside the previous London month, uploaded and submitted then.
    const inside = await insertAsset(service, {
      uploader: author.id,
      venue,
      createdAt: plusMinutes(start, 30),
    })
    const insideItem = await insertSubmittedItem(service, {
      asset: inside,
      venue,
      author: author.id,
      submittedAt: plusMinutes(start, 45),
    })
    // Uploaded just before that month started (the month before), submitted inside it.
    const before = await insertAsset(service, {
      uploader: author.id,
      venue,
      createdAt: plusMinutes(start, -30),
    })
    const beforeItem = await insertSubmittedItem(service, {
      asset: before,
      venue,
      author: author.id,
      submittedAt: plusMinutes(start, 60),
    })
    // Uploaded in the previous month, submitted only now. The RPC refuses this
    // as a monthly-only submission (outside_period), so it is stored directly.
    const lateSubmit = await insertAsset(service, {
      uploader: author.id,
      venue,
      createdAt: midMonth(previous),
    })
    const lateItem = await insertSubmittedItem(service, {
      asset: lateSubmit,
      venue,
      author: author.id,
      submittedAt: new Date().toISOString(),
    })
    // Uploaded and submitted in the previous month, accepted now, deleted now.
    const removed = await insertAsset(service, {
      uploader: author.id,
      venue,
      createdAt: midMonth(previous),
    })
    const removedItem = await insertSubmittedItem(service, {
      asset: removed,
      venue,
      author: author.id,
      submittedAt: plusMinutes(midMonth(previous), 10),
    })

    for (const id of [insideItem, beforeItem, lateItem, removedItem]) {
      await accept(service, manager, id)
    }
    await ok(
      author.client.rpc("delete_media_asset", { p_asset_id: removed.id })
    )

    expect(await progressOf(manager, author.id, previous)).toMatchObject({
      accepted_count: 2,
      late_accepted_count: 2,
      evidence_removed_count: 1,
      target_count: 2,
      complete: true,
    })
    expect((await progressOf(manager, author.id))?.accepted_count ?? 0).toBe(0)
  })

  it("drops a photo deleted during the current month and reopens coverage, keeping history", async () => {
    const requirement = await createRequirement(manager, venue, {
      title: "TEST deletion",
      photoTarget: 1,
    })
    await assign(manager, requirement, [author.id])
    const photo = await reserveReady(service, author)
    const [item] = await submit(author, [photo.id], requirement)
    await accept(service, manager, item!.item_id)
    let [req] = (await requirementProgress(manager, venue)).filter(
      (r) => r.requirement_id === requirement
    )
    expect(req).toMatchObject({ accepted_count: 1, satisfied: true })
    expect(await progressOf(manager, author.id)).toMatchObject({
      accepted_count: 1,
    })

    await ok(author.client.rpc("delete_media_asset", { p_asset_id: photo.id }))

    ;[req] = (await requirementProgress(manager, venue)).filter(
      (r) => r.requirement_id === requirement
    )
    expect(req).toMatchObject({
      accepted_count: 0,
      satisfied: false,
      evidence_removed_count: 1,
    })
    expect(await progressOf(manager, author.id)).toMatchObject({
      accepted_count: 0,
    })
    const { data: kept } = await service
      .from("coverage_submission_items")
      .select("state")
      .eq("id", item!.item_id)
      .single()
    expect(kept!.state).toBe("accepted")
    const { count: events } = await service
      .from("coverage_review_events")
      .select("id", { count: "exact", head: true })
      .eq("item_id", item!.item_id)
    expect(events).toBe(2)
    expect(
      await ok(
        manager.client.rpc("task_evidence_asset", { p_asset_id: photo.id })
      )
    ).toEqual([])
  })

  it("credits only the upload-time venue", async () => {
    const traveller = await staff("cov-rules-traveller", otherVenue)
    const elsewhere = await reserveReady(service, traveller)
    await service
      .from("profiles")
      .update({ venue_id: venue })
      .eq("id", traveller.id)
    await fails(
      traveller.client.rpc("submit_coverage_photos", {
        p_asset_ids: [elsewhere.id],
        p_client_request_key: requestKey(),
      }),
      "evidence_not_eligible"
    )
    const { data: asset } = await service
      .from("media_assets")
      .select("created_at")
      .eq("id", elsewhere.id)
      .single()
    const { data: submission } = await service
      .from("coverage_submissions")
      .insert({
        venue_id: venue,
        submitted_by: traveller.id,
        kind: "staff_submit",
        client_request_key: requestKey(),
        asset_ids: [elsewhere.id],
      })
      .select("id")
      .single()
    const { error } = await service.from("coverage_submission_items").insert({
      submission_id: submission!.id,
      venue_id: venue,
      asset_id: elsewhere.id,
      author_id: traveller.id,
      origin: "submitted",
      submitted_by: traveller.id,
      submitted_month: currentMonth(),
      uploaded_at: asset!.created_at,
      uploaded_month: currentMonth(),
    })
    // The (asset_id, venue_id) foreign key makes a cross-venue item impossible.
    expect(error?.code).toBe("23503")
  })
})
