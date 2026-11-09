// Credit compatibility (docs/knowledge/b01-design.md §3.6, C1 to C23):
// knowledge outcomes earn or move amenity credit only through adoption and
// reopen, exactly as today. Every scenario also checks menu-photo credit (C19)
// and that per-finding recognition matches the counted total (C20).
import { describe, expect, it } from "vitest"

import {
  accept as acceptCoverage,
  currentMonth,
  lastDay,
  midMonth,
  monthOffset,
  ok,
  psql,
  submit as submitCoverage,
} from "./coverage-fixtures"
import {
  count,
  decide,
  json,
  photo,
  resolve,
  service,
  slot,
  submit,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"
import { reserveReady } from "./menus-fixtures"

type Progress = {
  staff_id: string
  amenity_checks_completed: number
  completion_count: number
  accepted_count: number
  menu_items_completed: number
}

const contribution = (id: string) => ({ type: "contribution" as const, id })
const submission = (id: string) => ({ type: "submission" as const, id })

async function enrolled(label: string, opts: { from?: string } = {}) {
  const w = await world(label)
  const from = opts.from ?? currentMonth()
  psql(`insert into private.venue_monthly_completion_targets(venue_id, starts_on, target_count)
    values ('${w.venue}', '${from}', 5)`)
  if (from !== currentMonth()) {
    psql(`update private.completion_staff_venue_memberships set started_at = '${midMonth(from)}'
      where venue_id = '${w.venue}' and ended_at is null`)
  }
  // One accepted coverage photo for staff A: menu-photo credit must not move.
  const [item] = await submitCoverage(w.staffA, [(await reserveReady(service, w.staffA)).id])
  await acceptCoverage(service, w.admin, item!.item_id)
  return w
}

async function roster(w: World, month = currentMonth()) {
  return (await ok(
    w.admin.client.rpc("coverage_staff_progress_v2", { p_venue_id: w.venue, p_period_month: month })
  )) as unknown as Progress[]
}

/** Amenity units per person, after checking C19 and C20 for everyone. */
async function units(w: World, month = currentMonth()) {
  const rows = await roster(w, month)
  const out: Record<string, number> = {}
  for (const [name, who] of [["A", w.staffA], ["B", w.staffB], ["SM", w.staffManager]] as const) {
    const row = rows.find((r) => r.staff_id === who.id)!
    expect(row, name).toBeDefined()
    const scored = count(`select count(*) from public.amenity_submissions s
      where s.venue_id = '${w.venue}' and s.submitted_by = '${who.id}'
        and (date_trunc('month', s.created_at at time zone 'Europe/London'))::date = '${month}'
        and private.knowledge_submission_scored(s.id) ->> 'kind' = 'scored'`)
    expect(scored, `C20 ${name}`).toBe(row.amenity_checks_completed)
    expect(row.menu_items_completed, `C19 ${name}`).toBe(0)
    expect(row.accepted_count, `C19 ${name}`).toBe(who === w.staffA && month === currentMonth() ? 1 : 0)
    expect(row.completion_count).toBe(row.amenity_checks_completed)
    out[name] = row.amenity_checks_completed
  }
  expect(rows.find((r) => r.staff_id === w.manager.id), "manager account").toBeUndefined()
  // C20 for every submitter, participants or not: a scored submission always
  // has a credit row to count it.
  const scoredBy = psql(`select coalesce(string_agg(distinct s.submitted_by::text, ','), '')
    from public.amenity_submissions s
    where s.venue_id = '${w.venue}'
      and (date_trunc('month', s.created_at at time zone 'Europe/London'))::date = '${month}'
      and private.knowledge_submission_scored(s.id) ->> 'kind' = 'scored'`)
  for (const id of scoredBy.split(",").filter(Boolean)) {
    expect(rows.some((r) => r.staff_id === id), `C20 scored implies a credit row: ${id}`).toBe(true)
  }
  return out
}

const reopen = async (w: World, key: string) =>
  ok(
    w.manager.client.rpc("amenity_reopen_check", {
      p_check_id: w.checks[key]!,
      p_revision: count(`select revision from public.venue_amenity_checks where id = '${w.checks[key]}'`),
      p_preset: "conditions_changed",
      p_reason: null as unknown as string,
    })
  )

/** Moves a slot's history back to `at` (fixture only; append-only triggers off). */
function backdate(w: World, key: string, at: string) {
  const check = w.checks[key]
  psql(`begin;
    set local session_replication_role = replica;
    update public.knowledge_contributions set created_at = '${at}' where check_id = '${check}';
    update public.knowledge_decisions d set created_at = '${at}'
      from public.knowledge_contributions c where c.id = d.contribution_id and c.check_id = '${check}';
    update public.amenity_submissions set created_at = '${at}' where check_id = '${check}';
    update public.amenity_check_events set created_at = '${at}' where check_id = '${check}' and kind = 'submitted';
    update public.venue_amenity_checks set answered_at = '${at}' where id = '${check}' and answered_at is not null;
    commit;`)
}

const zero = { A: 0, B: 0, SM: 0 }

describe("credit for knowledge outcomes (C1 to C23)", () => {
  it("counts auto-adopted Yes, No and Not applicable once each (C1 to C3)", async () => {
    const w = await enrolled("kn-credit-c1")
    expect(await units(w)).toEqual(zero)
    const first = await yes(w.staffA, w, "onsite_parking")
    expect(first).toMatchObject({ outcome: "current", recognition: { kind: "scored", period: currentMonth().slice(0, 7) } })
    expect(await units(w)).toEqual({ ...zero, A: 1 })
    expect((await submit(w.staffA, w, "guest_toilets", { answer: "no" })).outcome).toBe("current")
    expect(await units(w)).toEqual({ ...zero, A: 2 })
    await ok(w.admin.client.rpc("amenity_add_checks", { p_venue_id: w.venue, p_keys: ["sports_screen"] }))
    w.checks.sports_screen = psql(`select id from public.venue_amenity_checks where venue_id = '${w.venue}' and template_key = 'sports_screen'`)
    await json(w.admin, "knowledge_set_working_list", { p_venue_id: w.venue, p_keys: ["sports_screen"], p_enabled: true, p_reason: "TEST" })
    expect((await submit(w.staffA, w, "sports_screen", { answer: "not_applicable" })).outcome).toBe("current")
    expect(await units(w)).toEqual({ ...zero, A: 3 })
  })

  it("never counts Couldn't establish, undecided proposals or pending and declined findings (C4 to C7)", async () => {
    const w = await enrolled("kn-credit-c4")
    expect(await submit(w.staffA, w, "onsite_parking", { answer: "unknown" })).toMatchObject({
      outcome: "recorded",
      recognition: { kind: "not_scored" },
    })
    await ok(
      w.manager.client.rpc("amenity_assign_check", {
        p_check_id: w.checks.guest_toilets!,
        p_assignee_id: w.staffB.id,
        p_revision: count(`select revision from public.venue_amenity_checks where id = '${w.checks.guest_toilets}'`),
      })
    )
    expect((await submit(w.staffA, w, "guest_toilets", { answer: "no" })).outcome).toBe("awaiting_confirmation")
    const pending = await yes(w.staffA, w, "step_free_entrance")
    expect(pending).toMatchObject({ outcome: "awaiting_confirmation", recognition: { kind: "pending" } })
    expect(await units(w)).toEqual(zero)
    expect((await decide(w.manager, w, "step_free_entrance", contribution(pending.contributionId), "decline", "TEST")).error).toBeNull()
    expect(await units(w)).toEqual(zero)
  })

  it("credits a confirmed finding to its contributor, and keeps it after revocation (C8, C12)", async () => {
    const w = await enrolled("kn-credit-c8")
    const r = await yes(w.staffA, w, "step_free_entrance")
    const { data, error } = await decide(w.manager, w, "step_free_entrance", contribution(r.contributionId), "confirm")
    expect(error).toBeNull()
    expect(await units(w)).toEqual({ ...zero, A: 1 })
    const adopted = (data as { submissionId: string }).submissionId
    expect((await decide(w.manager, w, "step_free_entrance", submission(adopted), "revoke", "TEST door changed")).error).toBeNull()
    expect(slot(w.venue, "step_free_entrance")).toMatchObject({ reason: "withdrawn", detail: "confirmation_revoked" })
    expect(await units(w)).toEqual({ ...zero, A: 1 })
  })

  it("counts a finding in its confirmation month, not its send month (C9)", async () => {
    const previous = monthOffset(-1)
    const w = await enrolled("kn-credit-c9", { from: previous })
    const r = await yes(w.staffA, w, "step_free_entrance")
    backdate(w, "step_free_entrance", `${lastDay(previous)}T21:30:00Z`)
    expect(psql(`select to_char(created_at at time zone 'Europe/London', 'YYYY-MM') from public.knowledge_contributions where id = '${r.contributionId}'`)).toBe(previous.slice(0, 7))
    expect((await decide(w.manager, w, "step_free_entrance", contribution(r.contributionId), "confirm")).error).toBeNull()
    expect(await units(w, previous)).toEqual(zero)
    expect(await units(w)).toEqual({ ...zero, A: 1 })
  })

  it("removes same-month credit on reopen and keeps an earlier month's (C10, C11)", async () => {
    const w = await enrolled("kn-credit-c10")
    await yes(w.staffA, w, "onsite_parking")
    await reopen(w, "onsite_parking")
    expect(await units(w)).toEqual(zero)

    const previous = monthOffset(-1)
    const v = await enrolled("kn-credit-c11", { from: previous })
    await yes(v.staffA, v, "onsite_parking")
    backdate(v, "onsite_parking", midMonth(previous))
    expect(await units(v, previous)).toEqual({ ...zero, A: 1 })
    await reopen(v, "onsite_parking")
    expect(await units(v, previous)).toEqual({ ...zero, A: 1 })
    expect(await units(v)).toEqual(zero)
  })

  it("keeps credit through evidence withdrawal, a dispute and a working-list change (C13, C14, C16)", async () => {
    const w = await enrolled("kn-credit-c13")
    const evidence = await photo(w.staffA.id, w.venue)
    await submit(w.staffA, w, "guest_toilets", { answer: "no", assets: [evidence] })
    await yes(w.staffA, w, "onsite_parking")
    expect(await units(w)).toEqual({ ...zero, A: 2 })
    psql(`update public.media_assets set deleted_at = now() where id = '${evidence}'`)
    expect(slot(w.venue, "guest_toilets")).toMatchObject({ reason: "withdrawn", detail: "evidence_withdrawn" })
    expect(await units(w)).toEqual({ ...zero, A: 2 })
    await submit(w.staffB, w, "onsite_parking", { kind: "change_report", answer: "no" })
    expect(slot(w.venue, "onsite_parking")).toMatchObject({ reason: "disputed" })
    expect(await units(w)).toEqual({ ...zero, A: 2 })
    await json(w.admin, "knowledge_set_working_list", {
      p_venue_id: w.venue,
      p_keys: ["onsite_parking", "guest_toilets"],
      p_enabled: false,
      p_reason: "TEST",
    })
    expect(await units(w)).toEqual({ ...zero, A: 2 })
  })

  it("moves credit to a later adopted proposal in the same month (C15)", async () => {
    const w = await enrolled("kn-credit-c15")
    await yes(w.staffA, w, "onsite_parking")
    const b = await submit(w.staffB, w, "onsite_parking", { kind: "change_report", answer: "no" })
    expect(b.outcome).toBe("awaiting_confirmation")
    expect(await units(w)).toEqual({ ...zero, A: 1 })
    expect((await resolve(w.manager, w, "onsite_parking", b.contributionId)).error).toBeNull()
    expect(await units(w)).toEqual({ ...zero, B: 1 })
  })

  it("credits a requested detail once, to its author (C17)", async () => {
    const w = await enrolled("kn-credit-c17")
    const first = await yes(w.staffB, w, "step_free_entrance")
    const asked = await json<{ decisionId: string }>(w.manager, "knowledge_decide", {
      p_target_type: "contribution",
      p_target_id: first.contributionId,
      p_decision: "request_detail",
      p_slot_revision: count(`select private.knowledge_slot_revision('${w.venue}', 'step_free_entrance')`),
      p_idempotency_key: crypto.randomUUID(),
      p_note: "TEST which door?",
    })
    expect(await units(w)).toEqual(zero)
    const detail = await yes(w.staffB, w, "step_free_entrance", { kind: "detail", respondsTo: asked.decisionId })
    expect(await units(w)).toEqual(zero)
    expect((await decide(w.manager, w, "step_free_entrance", contribution(detail.contributionId), "confirm")).error).toBeNull()
    expect(await units(w)).toEqual({ ...zero, B: 1 })
    expect(count(`select count(*) from public.amenity_submissions where check_id = '${w.checks.step_free_entrance}'`)).toBe(1)
  })

  it("counts a request retried with the same key once (C18)", async () => {
    const w = await enrolled("kn-credit-c18")
    const key = crypto.randomUUID()
    const evidence = await photo(w.staffA.id, w.venue)
    const revision = count(`select private.knowledge_slot_revision('${w.venue}', 'onsite_parking')`)
    const runs = []
    for (let i = 0; i < 3; i += 1) {
      runs.push(await submit(w.staffA, w, "onsite_parking", { key, revision, assets: [evidence] }))
    }
    expect(runs.map((r) => r.replayed)).toEqual([false, true, true])
    expect(runs.map((r) => r.recognition.kind)).toEqual(["scored", "scored", "scored"])
    expect(new Set(runs.map((r) => r.submissionId)).size).toBe(1)
    expect(await units(w)).toEqual({ ...zero, A: 1 })
  })

  it("moves credit to a direct capture by a granted staff account, not a manager account (C21, C22)", async () => {
    const w = await enrolled("kn-credit-c21")
    await yes(w.staffA, w, "onsite_parking")
    expect(await submit(w.staffManager, w, "onsite_parking", { answer: "no" })).toMatchObject({
      outcome: "current",
      recognition: { kind: "scored" },
    })
    expect(await units(w)).toEqual({ ...zero, SM: 1 })

    const v = await enrolled("kn-credit-c22")
    await yes(v.staffA, v, "onsite_parking")
    expect(await submit(v.manager, v, "onsite_parking", { answer: "no" })).toMatchObject({
      outcome: "current",
      recognition: { kind: "none" },
    })
    expect(await units(v)).toEqual(zero)
  })

  it("never lets Couldn't establish, seen or keep_in_use move another person's credit (C23)", async () => {
    const w = await enrolled("kn-credit-c23")
    await submit(w.staffB, w, "guest_toilets", { answer: "no" })
    const expected = { ...zero, B: 1 }
    expect(await units(w)).toEqual(expected)
    const unsure = await submit(w.staffA, w, "guest_toilets", { kind: "change_report", answer: "unknown" })
    expect(await units(w)).toEqual(expected)
    expect((await decide(w.manager, w, "guest_toilets", contribution(unsure.contributionId), "seen")).error).toBeNull()
    expect(await units(w)).toEqual(expected)
    await submit(w.staffA, w, "guest_toilets", { kind: "change_report", answer: "unknown", preset: "could_not_access" })
    expect(slot(w.venue, "guest_toilets")).toMatchObject({ reason: "disputed" })
    expect((await resolve(w.manager, w, "guest_toilets", null)).error).toBeNull()
    expect(slot(w.venue, "guest_toilets")).toMatchObject({ status: "available" })
    expect(await units(w)).toEqual(expected)
  })
})
