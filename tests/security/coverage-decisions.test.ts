// Contract decisions enforced in the database, so a direct PostgREST call
// cannot do more than the services allow: submissions to a requirement are
// assigned-only (D3), review decisions are final (D4), and monthly
// preparation adds every active venue's template checklist (D9), and a
// replacement only answers a request on its own requirement (D-003). Real
// identities; the service role only reads state back and probes guards.
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
  itemRevision,
  ok,
  psql,
  requestKey,
  requirementProgress,
  review,
  staffProgress,
  submit,
} from "./coverage-fixtures"
import { reserveReady } from "./menus-fixtures"

const service = serviceClient()
let admin: TestIdentity

async function staff(label: string, venueId: string) {
  return createIdentity(service, { label, role: "staff", venueId })
}

async function managedVenue(label: string) {
  const venueId = (await createVenue(service, label)).id
  const manager = await staff(`${label}-mgr`, venueId)
  await legacyStaffGrant(service, admin, manager.id, venueId)
  return { venueId, manager }
}

async function summary(who: TestIdentity, venueId: string) {
  const [row] = await ok(
    who.client.rpc("venue_coverage_summary", { p_venue_id: venueId })
  )
  return row!
}

async function countRows(
  table:
    | "coverage_requirements"
    | "venue_amenity_facts"
    | "monthly_targets"
    | "coverage_submissions",
  column: string,
  value: string
) {
  const { count, error } = await service
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value)
  if (error) throw error
  return count
}

async function decisionEvents(itemId: string) {
  const { count, error } = await service
    .from("coverage_review_events")
    .select("id", { count: "exact", head: true })
    .eq("item_id", itemId)
    .in("action", ["accepted", "needs_another_photo"])
  if (error) throw error
  return count
}

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "cov-dec-admin",
    role: "admin",
  })
})

describe("D3: submitting to a requirement needs an open assignment", () => {
  let venue: string
  let manager: TestIdentity
  let assigned: TestIdentity
  let teammate: TestIdentity
  let requirement: string

  beforeAll(async () => {
    ;({ venueId: venue, manager } = await managedVenue("cov-dec-assign"))
    assigned = await staff("cov-dec-assigned", venue)
    teammate = await staff("cov-dec-teammate", venue)
    // Same team as the assignee: FOH/BOH only suggests, it never permits.
    const { error } = await service
      .from("profiles")
      .update({ department: "foh" })
      .in("id", [assigned.id, teammate.id])
    if (error) throw error
    requirement = await createRequirement(manager, venue, {
      title: "TEST assigned only",
      photoTarget: 3,
    })
    await assign(manager, requirement, [assigned.id])
  })

  it("rejects anyone unassigned, writes nothing, and keeps monthly-only submissions", async () => {
    const photo = await reserveReady(service, teammate)
    const err = await fails(
      teammate.client.rpc("submit_coverage_photos", {
        p_asset_ids: [photo.id],
        p_requirement_id: requirement,
        p_client_request_key: requestKey(),
      }),
      "requirement_not_assigned",
      "P0001"
    )
    expect(err.details).toMatch(/assigned/)
    expect(
      await countRows("coverage_submissions", "submitted_by", teammate.id)
    ).toBe(0)

    // D2: the same photo with no requirement still counts for the month.
    const [monthly] = await submit(teammate, [photo.id])
    expect(monthly).toMatchObject({ state: "submitted", reused: false })

    // The venue manager is not assigned either: they attach instead.
    const own = await reserveReady(service, manager)
    await fails(
      manager.client.rpc("submit_coverage_photos", {
        p_asset_ids: [own.id],
        p_requirement_id: requirement,
        p_client_request_key: requestKey(),
      }),
      "requirement_not_assigned"
    )
    const attachable = await reserveReady(service, teammate)
    const [attached] = await ok(
      manager.client.rpc("attach_coverage_evidence", {
        p_requirement_id: requirement,
        p_asset_ids: [attachable.id],
        p_client_request_key: requestKey(),
      })
    )
    expect(attached).toMatchObject({ state: "submitted", reused: false })

    const mine = await reserveReady(service, assigned)
    const [item] = await submit(assigned, [mine.id], requirement)
    expect(item).toMatchObject({ state: "submitted", reused: false })
  })

  it("stops accepting photos, replacements included, once the assignment ends", async () => {
    const first = await reserveReady(service, assigned)
    const key = requestKey()
    const [item] = await submit(assigned, [first.id], requirement, key)
    await ok(
      review(manager, item!.item_id, 1, "needs_another_photo", "TEST too dark")
    )
    await assign(manager, requirement, [])

    const replacement = await reserveReady(service, assigned)
    const replace = () =>
      assigned.client.rpc("submit_coverage_photos", {
        p_asset_ids: [replacement.id],
        p_requirement_id: requirement,
        p_client_request_key: requestKey(),
        p_replaces_item_id: item!.item_id,
      })
    await fails(replace(), "requirement_not_assigned", "P0001")
    await fails(
      assigned.client.rpc("submit_coverage_photos", {
        p_asset_ids: [(await reserveReady(service, assigned)).id],
        p_requirement_id: requirement,
        p_client_request_key: requestKey(),
      }),
      "requirement_not_assigned"
    )
    // A retry of the request made while assigned replays it; nothing is added.
    const [replayed] = await submit(assigned, [first.id], requirement, key)
    expect(replayed).toMatchObject({ item_id: item!.item_id, reused: true })

    await assign(manager, requirement, [assigned.id])
    const [next] = await ok(replace())
    const { data } = await service
      .from("coverage_submission_items")
      .select("replaces_item_id, requirement_id")
      .eq("id", next!.item_id)
      .single()
    expect(data).toEqual({
      replaces_item_id: item!.item_id,
      requirement_id: requirement,
    })
  })

  it("checks the venue and the requirement's state before the assignment", async () => {
    const elsewhere = await managedVenue("cov-dec-assign-other")
    const foreign = await createRequirement(
      elsewhere.manager,
      elsewhere.venueId
    )
    const photo = await reserveReady(service, teammate)
    await fails(
      teammate.client.rpc("submit_coverage_photos", {
        p_asset_ids: [photo.id],
        p_requirement_id: foreign,
        p_client_request_key: requestKey(),
      }),
      "coverage_requirement_not_found",
      "P0002"
    )
    const closed = await createRequirement(manager, venue, {
      title: "TEST closed",
    })
    await ok(
      manager.client.rpc("set_coverage_requirement_status", {
        p_requirement_id: closed,
        p_expected_revision: 1,
        p_status: "not_applicable",
        p_reason: "TEST not here",
      })
    )
    await fails(
      teammate.client.rpc("submit_coverage_photos", {
        p_asset_ids: [photo.id],
        p_requirement_id: closed,
        p_client_request_key: requestKey(),
      }),
      "requirement_not_open"
    )
  })
})

describe("D4: review decisions are final", () => {
  let venue: string
  let manager: TestIdentity
  let author: TestIdentity

  beforeAll(async () => {
    ;({ venueId: venue, manager } = await managedVenue("cov-dec-review"))
    author = await staff("cov-dec-author", venue)
  })

  it("refuses a different decision, replays the same one and checks the revision first", async () => {
    const photo = await reserveReady(service, author)
    const [item] = await submit(author, [photo.id])
    const id = item!.item_id
    const [decided] = await ok(review(manager, id, 1, "accepted"))
    expect(decided).toMatchObject({ state: "accepted", revision: 2 })

    for (const who of [manager, admin]) {
      const err = await fails(
        review(who, id, 2, "needs_another_photo", "TEST second thoughts"),
        "invalid_transition",
        "P0001"
      )
      expect(err.details).toBe("accepted -> needs_another_photo")
    }

    const [again] = await ok(review(manager, id, 2, "accepted"))
    expect(again).toMatchObject({
      state: "accepted",
      revision: 2,
      replayed: true,
    })
    const key = requestKey()
    const [keyed] = await ok(review(manager, id, 2, "accepted", null, key))
    expect(keyed).toMatchObject({ replayed: true, revision: 2 })
    const { count: keyedEvents } = await service
      .from("coverage_review_events")
      .select("id", { count: "exact", head: true })
      .eq("client_request_key", key)
    expect(keyedEvents).toBe(0)

    for (const decision of ["accepted", "needs_another_photo"] as const) {
      await fails(
        review(manager, id, 1, decision, "TEST stale"),
        "coverage_conflict",
        "40001"
      )
    }

    expect(await decisionEvents(id)).toBe(1)
    expect(await itemRevision(service, id)).toEqual({
      revision: 2,
      state: "accepted",
    })
    const [row] = (await staffProgress(manager, venue, currentMonth())).filter(
      (r) => r.staff_id === author.id
    )
    expect(row!.accepted_count).toBe(1)
  })

  it("does not accept a photo after asking for another one", async () => {
    const photo = await reserveReady(service, author)
    const [item] = await submit(author, [photo.id])
    await ok(
      review(manager, item!.item_id, 1, "needs_another_photo", "TEST blurry")
    )
    const err = await fails(
      review(manager, item!.item_id, 2, "accepted"),
      "invalid_transition"
    )
    expect(err.details).toBe("needs_another_photo -> accepted")
    const [same] = await ok(
      review(manager, item!.item_id, 2, "needs_another_photo", "TEST again")
    )
    expect(same).toMatchObject({ replayed: true, state: "needs_another_photo" })
    expect(await decisionEvents(item!.item_id)).toBe(1)
  })

  it("keeps a decision even against direct service-role writes", async () => {
    const photo = await reserveReady(service, author)
    const [item] = await submit(author, [photo.id])
    await accept(service, manager, item!.item_id)
    const { revision } = await itemRevision(service, item!.item_id)
    const attempts = [
      {
        state: "needs_another_photo",
        decision_reason: "TEST direct",
        revision: revision + 1,
      },
      { decided_by: admin.id, revision: revision + 1 },
      { decision_reason: "TEST rewritten", revision: revision + 1 },
    ]
    for (const patch of attempts) {
      const { error } = await service
        .from("coverage_submission_items")
        .update(patch)
        .eq("id", item!.item_id)
      expect(error?.message, JSON.stringify(patch)).toBe("invalid_transition")
    }
    expect(await itemRevision(service, item!.item_id)).toEqual({
      revision,
      state: "accepted",
    })
  })

  it("has no withdrawal or relink: a submitted item waits for review", async () => {
    expect(
      psql(`select count(*) from pg_proc where proname in
        ('withdraw_coverage_item', 'relink_coverage_item', 'ensure_venue_coverage_candidates')`)
    ).toBe("0")
    expect(
      psql(`select count(*) from pg_constraint
        where conrelid in ('public.coverage_submission_items'::regclass, 'public.coverage_review_events'::regclass)
          and pg_get_constraintdef(oid) like '%withdrawn%'`)
    ).toBe("0")
    const photo = await reserveReady(service, author)
    const [item] = await submit(author, [photo.id])
    const { error } = await service
      .from("coverage_submission_items")
      .update({ state: "withdrawn", revision: 2 })
      .eq("id", item!.item_id)
    expect(error?.message).toBe("invalid_transition")
    expect(await itemRevision(service, item!.item_id)).toEqual({
      revision: 1,
      state: "submitted",
    })
  })
})

describe("D9: monthly preparation adds each active venue's checklist", () => {
  it("adds the template candidates once, so a venue cannot stay complete without them", async () => {
    const { venueId, manager } = await managedVenue("cov-dec-prep")
    const requirement = await createRequirement(manager, venueId, {
      title: "TEST frontage",
    })
    await assign(manager, requirement, [manager.id])
    const photo = await reserveReady(service, manager)
    const [item] = await submit(manager, [photo.id], requirement)
    await accept(service, manager, item!.item_id)
    expect(await summary(manager, venueId)).toMatchObject({
      applicable_count: 1,
      complete: true,
    })

    const [run] = await ok(
      manager.client.rpc("prepare_coverage_month", { p_venue_id: venueId })
    )
    expect(run).toMatchObject({
      status: "succeeded",
      candidates_added: 12,
      staff_considered: 1,
    })
    expect(await summary(manager, venueId)).toMatchObject({
      needs_setup_count: 12,
      amenity_unknown_count: 7,
      complete: false,
    })
    const { data: added } = await service
      .from("coverage_requirements")
      .select("created_by")
      .eq("venue_id", venueId)
      .not("amenity_key", "is", null)
    expect(added!.every((r) => r.created_by === manager.id)).toBe(true)

    const [again] = await ok(
      manager.client.rpc("prepare_coverage_month", { p_venue_id: venueId })
    )
    expect(again).toMatchObject({ status: "succeeded", candidates_added: 0 })
    expect(await countRows("coverage_requirements", "venue_id", venueId)).toBe(
      13
    )
  })

  it("covers every active venue on the scheduled run, including ones without staff", async () => {
    const empty = (await createVenue(service, "cov-dec-empty")).id
    const closed = (await createVenue(service, "cov-dec-closed", false)).id
    const [run] = await ok(service.rpc("prepare_coverage_month_scheduled"))
    expect(run!.status).toBe("succeeded")
    expect(run!.candidates_added).toBeGreaterThanOrEqual(12)
    expect(await countRows("coverage_requirements", "venue_id", empty)).toBe(12)
    expect(await countRows("venue_amenity_facts", "venue_id", empty)).toBe(7)
    expect(await countRows("coverage_requirements", "venue_id", closed)).toBe(0)
    const { data: audit } = await service
      .from("coverage_audit_events")
      .select("actor_id, actor_role, after")
      .eq("venue_id", empty)
      .eq("action", "candidates_added")
    expect(audit).toEqual([
      { actor_id: null, actor_role: "system", after: { count: 12 } },
    ])
  })

  it("records a failed run with no partial checklist or targets", async () => {
    const { venueId, manager } = await managedVenue("cov-dec-fail")
    psql(`
      create function public.zz_test_block_coverage_candidates() returns trigger
      language plpgsql as $$ begin raise exception 'TEST blocked'; end $$;
      create trigger zz_test_block_coverage_candidates
        before insert on public.coverage_requirements for each row
        when (new.venue_id = '${venueId}')
        execute function public.zz_test_block_coverage_candidates();
    `)
    try {
      const [run] = await ok(
        manager.client.rpc("prepare_coverage_month", { p_venue_id: venueId })
      )
      expect(run).toMatchObject({
        status: "failed",
        error_code: "P0001",
        candidates_added: 0,
        placeholders_created: 0,
      })
    } finally {
      psql(`
        drop trigger zz_test_block_coverage_candidates on public.coverage_requirements;
        drop function public.zz_test_block_coverage_candidates();
      `)
    }
    expect(await countRows("venue_amenity_facts", "venue_id", venueId)).toBe(0)
    expect(await countRows("monthly_targets", "venue_id", venueId)).toBe(0)
    const [status] = await ok(
      manager.client.rpc("coverage_preparation_status", { p_venue_id: venueId })
    )
    expect(status).toMatchObject({
      last_status: "failed",
      last_error_code: "P0001",
      staff_without_target: 1,
    })

    const [retry] = await ok(
      manager.client.rpc("prepare_coverage_month", { p_venue_id: venueId })
    )
    expect(retry).toMatchObject({
      status: "succeeded",
      candidates_added: 12,
      placeholders_created: 1,
    })
  })
})

describe("D-003: a replacement answers a request only on its own requirement", () => {
  let venue: string
  let manager: TestIdentity
  let mover: TestIdentity
  let backBar: string
  let garden: string

  beforeAll(async () => {
    ;({ venueId: venue, manager } = await managedVenue("cov-dec-move"))
    mover = await staff("cov-dec-mover", venue)
    backBar = await createRequirement(manager, venue, {
      title: "TEST back bar shelves",
      photoTarget: 5,
    })
    garden = await createRequirement(manager, venue, {
      title: "TEST garden seating",
      photoTarget: 5,
    })
    await assign(manager, backBar, [mover.id])
    await assign(manager, garden, [mover.id])
  })

  /** A request for another photo on the requirement (NULL: monthly only). */
  async function request(requirement: string | null) {
    const photo = await reserveReady(service, mover)
    const [item] = await submit(mover, [photo.id], requirement)
    await ok(
      review(manager, item!.item_id, 1, "needs_another_photo", "TEST too dark")
    )
    return item!.item_id
  }

  const send = (
    assetId: string,
    requirement: string | null,
    replaces: string | null = null
  ) =>
    mover.client.rpc("submit_coverage_photos", {
      p_asset_ids: [assetId],
      p_requirement_id: requirement as string,
      p_client_request_key: requestKey(),
      p_replaces_item_id: replaces as string,
    })

  async function answer(requestId: string, requirement: string | null) {
    const photo = await reserveReady(service, mover)
    const [item] = await ok(send(photo.id, requirement, requestId))
    return { asset: photo.id, item: item!.item_id }
  }

  async function link(itemId: string) {
    const { data, error } = await service
      .from("coverage_submission_items")
      .select("requirement_id, replaces_item_id, revision")
      .eq("id", itemId)
      .single()
    if (error) throw error
    return data
  }

  async function lastRelink(itemId: string) {
    const { data, error } = await service
      .from("coverage_review_events")
      .select("requirement_id, cleared_replaces_item_id")
      .eq("item_id", itemId)
      .eq("action", "relinked")
      .order("id", { ascending: false })
      .limit(1)
      .single()
    if (error) throw error
    return data
  }

  async function openRequests() {
    const rows = await requirementProgress(manager, venue)
    const count = (id: string) =>
      rows.find((r) => r.requirement_id === id)!.needs_another_photo_count
    return { backBar: count(backBar), garden: count(garden) }
  }

  it("re-opens the request when its pending replacement moves to another task or to monthly-only", async () => {
    const backBarRequest = await request(backBar)
    const x = await answer(backBarRequest, backBar)
    const before = await openRequests()

    const [moved] = await ok(send(x.asset, garden))
    expect(moved).toMatchObject({
      item_id: x.item,
      state: "submitted",
      revision: 2,
      reused: false,
    })
    expect(await link(x.item)).toEqual({
      requirement_id: garden,
      replaces_item_id: null,
      revision: 2,
    })
    expect(await lastRelink(x.item)).toEqual({
      requirement_id: garden,
      cleared_replaces_item_id: backBarRequest,
    })
    expect(await openRequests()).toEqual({
      backBar: before.backBar + 1,
      garden: before.garden,
    })

    const second = await request(backBar)
    const y = await answer(second, backBar)
    const [monthly] = await ok(send(y.asset, null))
    expect(monthly).toMatchObject({ item_id: y.item, revision: 2 })
    expect(await link(y.item)).toEqual({
      requirement_id: null,
      replaces_item_id: null,
      revision: 2,
    })
    expect(await lastRelink(y.item)).toEqual({
      requirement_id: null,
      cleared_replaces_item_id: second,
    })
    expect((await openRequests()).backBar).toBe(before.backBar + 2)
  })

  it("keeps a new link supplied with the move, only if it is a request on the destination", async () => {
    const backBarRequest = await request(backBar)
    const gardenRequest = await request(garden)
    const x = await answer(backBarRequest, backBar)
    const before = await openRequests()

    await fails(
      send(x.asset, garden, backBarRequest),
      "coverage_item_not_found",
      "P0002"
    )
    const [moved] = await ok(send(x.asset, garden, gardenRequest))
    expect(moved).toMatchObject({ item_id: x.item, revision: 2 })
    expect(await link(x.item)).toEqual({
      requirement_id: garden,
      replaces_item_id: gardenRequest,
      revision: 2,
    })
    expect(await lastRelink(x.item)).toEqual({
      requirement_id: garden,
      cleared_replaces_item_id: backBarRequest,
    })
    expect(await openRequests()).toEqual({
      backBar: before.backBar + 1,
      garden: before.garden - 1,
    })
  })

  it("clears a monthly replacement's link when a manager attaches it to a task", async () => {
    const monthlyRequest = await request(null)
    const y = await answer(monthlyRequest, null)
    const open = async () =>
      (await staffProgress(manager, venue, currentMonth(), mover.id))[0]!
        .needs_another_photo_count
    const before = await open()

    const [attached] = await ok(
      manager.client.rpc("attach_coverage_evidence", {
        p_requirement_id: garden,
        p_asset_ids: [y.asset],
        p_client_request_key: requestKey(),
      })
    )
    expect(attached).toMatchObject({
      item_id: y.item,
      state: "submitted",
      revision: 2,
      reused: false,
    })
    expect(await link(y.item)).toEqual({
      requirement_id: garden,
      replaces_item_id: null,
      revision: 2,
    })
    expect(await lastRelink(y.item)).toEqual({
      requirement_id: garden,
      cleared_replaces_item_id: monthlyRequest,
    })
    expect(await open()).toBe(before + 1)
  })

  it("keeps every live replacement on its request's requirement, even for direct writes", async () => {
    const backBarRequest = await request(backBar)
    const x = await answer(backBarRequest, backBar)
    const update = (patch: {
      requirement_id?: string
      replaces_item_id?: string
    }) =>
      service
        .from("coverage_submission_items")
        .update({ ...patch, revision: 2 })
        .eq("id", x.item)

    const moved = await update({ requirement_id: garden })
    expect(moved.error?.message).toBe("coverage_item_replacement_mismatch")
    const relinked = await update({ replaces_item_id: await request(backBar) })
    expect(relinked.error?.message).toBe("coverage_item_identity_immutable")
    const { error } = await service.from("coverage_review_events").insert({
      item_id: x.item,
      venue_id: venue,
      author_id: mover.id,
      actor_role: "system",
      action: "submitted",
      to_state: "submitted",
      revision: 1,
      cleared_replaces_item_id: backBarRequest,
    })
    expect(error?.message).toMatch(/coverage_review_events_cleared_link/)
    expect(await link(x.item)).toEqual({
      requirement_id: backBar,
      replaces_item_id: backBarRequest,
      revision: 1,
    })
  })
})
