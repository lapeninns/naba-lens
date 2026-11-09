// Confirmation, conflict, dispute, evidence withdrawal and revisions
// (docs/knowledge/b01-design.md §9, §10, §5.5, §17 T5, T8, T9, T15).
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { ok, psql } from "./coverage-fixtures"
import {
  call,
  count,
  decide,
  json,
  photo,
  refused,
  resolve,
  service,
  slot,
  slotRevision,
  submit,
  submitArgs,
  yes,
  world,
  type World,
} from "./knowledge-fixtures"

const contribution = (id: string) => ({ type: "contribution" as const, id })
const submission = (id: string) => ({ type: "submission" as const, id })

function decisions(contributionId: string) {
  return psql(
    `select coalesce(string_agg(decision, ',' order by created_at, id), '') from public.knowledge_decisions where contribution_id = '${contributionId}'`
  )
}

async function reopen(w: World, key: string) {
  const check = w.checks[key]!
  return ok(
    w.manager.client.rpc("amenity_reopen_check", {
      p_check_id: check,
      p_revision: count(`select revision from public.venue_amenity_checks where id = '${check}'`),
      p_preset: "conditions_changed",
      p_reason: null as unknown as string,
    })
  )
}

describe("confirmation (T5)", () => {
  it("keeps a staff step-free finding pending until a manager confirms it", async () => {
    const w = await world("kn-confirm")
    const r = await yes(w.staffA, w, "step_free_entrance")
    expect(r.outcome).toBe("awaiting_confirmation")
    expect(r.submissionId).toBeNull()
    expect(slot(w.venue, "step_free_entrance")).toMatchObject({ reason: "not_confirmed", detail: "pending" })
    const d = await json<{ submissionId: string }>(w.manager, "knowledge_decide", {
      p_target_type: "contribution",
      p_target_id: r.contributionId,
      p_decision: "confirm",
      p_slot_revision: slotRevision(w.venue, "step_free_entrance"),
      p_idempotency_key: randomUUID(),
      p_note: null,
    })
    expect(slot(w.venue, "step_free_entrance")).toMatchObject({
      status: "available",
      confirmation_state: "confirmed",
      confirmation_basis: "venue_manager",
      confirmation_self: false,
      current_submission_id: d.submissionId,
    })
    expect(psql(`select submitted_by from public.amenity_submissions where id = '${d.submissionId}'`)).toBe(w.staffA.id)
  })

  it("asks for detail, takes the detail and confirms it", async () => {
    const w = await world("kn-detail")
    const r = await yes(w.staffA, w, "step_free_entrance")
    const asked = await json<{ decisionId: string }>(w.manager, "knowledge_decide", {
      p_target_type: "contribution",
      p_target_id: r.contributionId,
      p_decision: "request_detail",
      p_slot_revision: slotRevision(w.venue, "step_free_entrance"),
      p_idempotency_key: randomUUID(),
      p_note: "TEST show the door",
    })
    const detail = await yes(w.staffA, w, "step_free_entrance", { kind: "detail", respondsTo: asked.decisionId })
    expect(detail.replacedOwn).toBe(r.contributionId)
    expect(decisions(r.contributionId)).toBe("detail_requested,replaced")
    const res = await decide(w.manager, w, "step_free_entrance", contribution(detail.contributionId), "confirm")
    expect(res.error).toBeNull()
    expect(slot(w.venue, "step_free_entrance").status).toBe("available")
  })

  it("refuses a stale screen and a second decision", async () => {
    const w = await world("kn-stalescreen")
    const r = await yes(w.staffA, w, "step_free_entrance")
    const stale = slotRevision(w.venue, "step_free_entrance")
    await submit(w.staffB, w, "step_free_entrance", { answer: "unknown" })
    const e = await decide(w.manager, w, "step_free_entrance", contribution(r.contributionId), "confirm", null, { revision: stale })
    expect(e.error?.message).toBe("amenity_conflict")
    expect((await decide(w.manager, w, "step_free_entrance", contribution(r.contributionId), "decline", "TEST no")).error).toBeNull()
    const again = await decide(w.manager, w, "step_free_entrance", contribution(r.contributionId), "confirm")
    expect(again.error).toMatchObject({ message: "already_decided", code: "NLK03" })
  })

  it("records self-confirmation, and refuses it where the rule forbids it", async () => {
    const w = await world("kn-self", { extra: ["high_chairs"], inScope: [] })
    const own = await yes(w.manager, w, "step_free_entrance", { confirmOwn: true })
    expect(own.outcome).toBe("current")
    expect(slot(w.venue, "step_free_entrance")).toMatchObject({ confirmation_state: "confirmed", confirmation_self: true })

    // A rule that forbids self-confirmation (test fixture key).
    psql(`insert into public.knowledge_question_rules (question_key, rule_version, confirmation, self_confirmation_allowed, unassigned_auto_complete)
      select 'high_chairs', 1, 'venue_manager', false, false
      where not exists (select 1 from public.knowledge_question_rules where question_key = 'high_chairs')`)
    await json(w.admin, "knowledge_set_working_list", { p_venue_id: w.venue, p_keys: ["high_chairs"], p_enabled: true, p_reason: "TEST" })
    const before = count(`select count(*) from public.knowledge_contributions where check_id = '${w.checks.high_chairs}'`)
    await refused(
      w.manager,
      "knowledge_submit",
      submitArgs(w, "high_chairs", { assets: [await photo(w.manager.id, w.venue)], confirmOwn: true }),
      "self_confirmation_not_permitted",
      "NLK04"
    )
    expect(count(`select count(*) from public.knowledge_contributions where check_id = '${w.checks.high_chairs}'`)).toBe(before)
    const pending = await yes(w.manager, w, "high_chairs")
    expect(pending.outcome).toBe("awaiting_confirmation")
    const e = await decide(w.manager, w, "high_chairs", contribution(pending.contributionId), "confirm")
    expect(e.error).toMatchObject({ message: "self_confirmation_not_permitted", code: "NLK04" })
  })

  it("never lets staff confirm, and handles confirm_own by role (G5)", async () => {
    const w = await world("kn-staffconfirm")
    const r = await yes(w.staffA, w, "step_free_entrance")
    const e = await decide(w.staffB, w, "step_free_entrance", contribution(r.contributionId), "confirm")
    expect(e.error).toMatchObject({ message: "not_venue_manager", code: "42501" })
    await refused(w.staffA, "knowledge_submit", submitArgs(w, "guest_toilets", { answer: "no", confirmOwn: true }), "not_venue_manager", "42501")
    // Ignored on a confirmation-free key: current, and no confirmed decision.
    const free = await submit(w.manager, w, "guest_toilets", { answer: "no", confirmOwn: true })
    expect(free.outcome).toBe("current")
    expect(count(`select count(*) from public.knowledge_decisions where submission_id = '${free.submissionId}' and decision = 'confirmed'`)).toBe(0)
  })

  it("keeps a dog-policy photo finding pending until the manager confirms (fixture)", async () => {
    const w = await world("kn-dogs", { extra: ["dogs_inside"], inScope: ["dogs_inside"] })
    const r = await yes(w.staffA, w, "dogs_inside", { finding: "TEST bar area only" })
    expect(r.outcome).toBe("awaiting_confirmation")
    expect(slot(w.venue, "dogs_inside")).toMatchObject({ reason: "not_confirmed", detail: "pending" })
    expect((await decide(w.manager, w, "dogs_inside", contribution(r.contributionId), "confirm")).error).toBeNull()
    expect(slot(w.venue, "dogs_inside")).toMatchObject({ status: "available", confirmation_basis: "venue_manager" })
  })
})

describe("eligibility changes (T8)", () => {
  it("disputes on a contradicting report but not on a same-value one", async () => {
    const w = await world("kn-dispute")
    await submit(w.staffA, w, "guest_toilets", { answer: "no" })
    await submit(w.staffB, w, "guest_toilets", { kind: "change_report", answer: "no", reason: "TEST still none" })
    expect(slot(w.venue, "guest_toilets").status).toBe("available")
    await submit(w.staffB, w, "guest_toilets", { kind: "change_report", answer: "yes", assets: [await photo(w.staffB.id, w.venue)] })
    expect(slot(w.venue, "guest_toilets")).toMatchObject({ reason: "disputed", detail: "conflict", value: null, current_answer: "no" })
  })

  it("goes stale on reopen and on lost Yes evidence", async () => {
    const w = await world("kn-stale-states")
    await yes(w.staffA, w, "onsite_parking")
    await reopen(w, "onsite_parking")
    expect(slot(w.venue, "onsite_parking")).toMatchObject({ reason: "stale", detail: "recheck_requested" })

    const r = await yes(w.staffA, w, "guest_toilets")
    const asset = psql(`select asset_id from public.amenity_submission_assets where submission_id = '${r.submissionId}'`)
    await ok(service.from("media_assets").update({ deleted_at: new Date().toISOString() }).eq("id", asset))
    expect(slot(w.venue, "guest_toilets")).toMatchObject({ reason: "stale", detail: "evidence_lost" })
  })

  it("withdraws a No whose evidence was deleted until a manager reaffirms it", async () => {
    const w = await world("kn-withdrawn")
    const evidence = await photo(w.staffA.id, w.venue)
    const r = await submit(w.staffA, w, "guest_toilets", { answer: "no", assets: [evidence] })
    const before = slotRevision(w.venue, "guest_toilets")
    await ok(service.from("media_assets").update({ deleted_at: new Date().toISOString() }).eq("id", evidence))
    expect(slotRevision(w.venue, "guest_toilets")).toBeGreaterThan(before)
    expect(slot(w.venue, "guest_toilets")).toMatchObject({ reason: "withdrawn", detail: "evidence_withdrawn", evidence_state: "withdrawn" })
    expect(count(`select count(*) from public.amenity_check_events where check_id = '${w.checks.guest_toilets}' and kind = 'evidence_lost'`)).toBe(0)
    expect((await decide(w.manager, w, "guest_toilets", submission(r.submissionId!), "reaffirm", "TEST seen in person")).error).toBeNull()
    expect(slot(w.venue, "guest_toilets").status).toBe("available")
  })

  it("withdraws a revoked confirmation and an archived answer", async () => {
    const w = await world("kn-revoke")
    const r = await yes(w.manager, w, "step_free_entrance", { confirmOwn: true })
    expect((await decide(w.manager, w, "step_free_entrance", submission(r.submissionId!), "revoke", "TEST door changed")).error).toBeNull()
    expect(slot(w.venue, "step_free_entrance")).toMatchObject({ reason: "withdrawn", detail: "confirmation_revoked" })

    await submit(w.staffA, w, "guest_toilets", { answer: "no" })
    const check = w.checks.guest_toilets!
    await ok(
      w.manager.client.rpc("amenity_archive_check", {
        p_check_id: check,
        p_revision: count(`select revision from public.venue_amenity_checks where id = '${check}'`),
      })
    )
    expect(slot(w.venue, "guest_toilets")).toMatchObject({ reason: "withdrawn", detail: "answer_withdrawn" })
  })

  it("settles every listed finding with a conflict decision (disputed-service fixture)", async () => {
    const w = await world("kn-conflict", { extra: ["sports_screen"], inScope: ["sports_screen"] })
    await yes(w.staffA, w, "sports_screen")
    const no = await submit(w.staffB, w, "sports_screen", { kind: "change_report", answer: "no", reason: "TEST screens removed" })
    const unsure = await submit(w.staffManager, w, "sports_screen", { kind: "change_report", answer: "unknown" })
    expect(slot(w.venue, "sports_screen").detail).toBe("conflict")
    // Keep the answer in use: the No is declined and the Couldn't establish is seen.
    const kept = await resolve(w.manager, w, "sports_screen", null)
    expect(kept.error).toBeNull()
    expect(decisions(no.contributionId)).toBe("declined")
    expect(decisions(unsure.contributionId)).toBe("seen")
    expect(slot(w.venue, "sports_screen").status).toBe("available")

    // Use this answer: adopts one, settles the rest; later findings can dispute again.
    const a = await submit(w.staffB, w, "sports_screen", { kind: "change_report", answer: "no", reason: "TEST again" })
    const b = await submit(w.staffA, w, "sports_screen", { kind: "change_report", answer: "not_applicable", reason: "TEST closed" })
    const c = await submit(w.staffManager, w, "sports_screen", { kind: "change_report", answer: "unknown" })
    const chosen = await resolve(w.manager, w, "sports_screen", a.contributionId)
    expect(chosen.error).toBeNull()
    expect(decisions(a.contributionId)).toBe("adopted")
    expect(decisions(b.contributionId)).toBe("declined")
    expect(decisions(c.contributionId)).toBe("seen")
    expect(slot(w.venue, "sports_screen")).toMatchObject({ status: "available", value: "no" })
    await submit(w.staffA, w, "sports_screen", { kind: "change_report", answer: "unknown" })
    expect(slot(w.venue, "sports_screen").detail).toBe("conflict")
  })

  it("lets one person dispute again after keep_in_use or seen (G9)", async () => {
    const w = await world("kn-redispute")
    await submit(w.staffA, w, "guest_toilets", { answer: "no" })
    const first = await submit(w.staffB, w, "guest_toilets", { kind: "change_report", answer: "unknown" })
    expect(slot(w.venue, "guest_toilets").detail).toBe("conflict")
    expect((await decide(w.manager, w, "guest_toilets", contribution(first.contributionId), "seen")).error).toBeNull()
    expect(slot(w.venue, "guest_toilets").status).toBe("available")
    await submit(w.staffB, w, "guest_toilets", { kind: "change_report", answer: "unknown" })
    expect(slot(w.venue, "guest_toilets").detail).toBe("conflict")
    expect((await resolve(w.manager, w, "guest_toilets", null)).error).toBeNull()
    expect(slot(w.venue, "guest_toilets").status).toBe("available")
    const third = await submit(w.staffB, w, "guest_toilets", { kind: "change_report", answer: "unknown" })
    const fourth = await submit(w.staffB, w, "guest_toilets", { kind: "change_report", answer: "unknown", preset: "other" })
    expect(fourth.replacedOwn).toBe(third.contributionId)
    expect(slot(w.venue, "guest_toilets")).toMatchObject({ detail: "conflict", pending_count: 1 })
  })
})

describe("revisions (T9)", () => {
  it("rises strictly across every transition and never falls", async () => {
    const w = await world("kn-revision")
    const seen: number[] = [slotRevision(w.venue, "guest_toilets")]
    const note = () => seen.push(slotRevision(w.venue, "guest_toilets"))
    await submit(w.staffA, w, "guest_toilets", { answer: "no" }); note()
    await submit(w.staffB, w, "guest_toilets", { kind: "change_report", answer: "unknown" }); note()
    await resolve(w.manager, w, "guest_toilets", null); note()
    await reopen(w, "guest_toilets"); note()
    await submit(w.staffA, w, "guest_toilets", { answer: "not_applicable" }); note()
    await json(w.admin, "knowledge_set_working_list", { p_venue_id: w.venue, p_keys: ["guest_toilets"], p_enabled: false, p_reason: "TEST" }); note()
    await json(w.admin, "knowledge_set_working_list", { p_venue_id: w.venue, p_keys: ["guest_toilets"], p_enabled: true, p_reason: "TEST" }); note()
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]!)
  })

  it("raises in-scope slots of a key on a definition change, and no other key (G3)", async () => {
    const w = await world("kn-defchange")
    const out = await world("kn-defchange-out", { enable: false })
    const before = { toilets: slotRevision(w.venue, "guest_toilets"), parking: slotRevision(w.venue, "onsite_parking"), out: slotRevision(out.venue, "guest_toilets") }
    psql("select private.knowledge_note_definition_change('guest_toilets', 'question_version_changed')")
    expect(slotRevision(w.venue, "guest_toilets")).toBe(before.toilets + 1)
    expect(slotRevision(w.venue, "onsite_parking")).toBe(before.parking)
    expect(slotRevision(out.venue, "guest_toilets")).toBe(before.out)
  })
})

describe("a disabled slot (T15, G7)", () => {
  it("allows non-adopting decisions, refuses adoption and new sends, and restores disputes on re-enable", async () => {
    const w = await world("kn-disabled")
    await submit(w.staffA, w, "guest_toilets", { answer: "no" })
    const a = await submit(w.staffB, w, "guest_toilets", { kind: "change_report", answer: "yes", assets: [await photo(w.staffB.id, w.venue)] })
    const b = await submit(w.staffManager, w, "guest_toilets", { kind: "change_report", answer: "unknown" })
    const c = await submit(w.staffA, w, "guest_toilets", { kind: "change_report", answer: "not_applicable", reason: "TEST" })
    await json(w.admin, "knowledge_set_working_list", { p_venue_id: w.venue, p_keys: ["guest_toilets"], p_enabled: false, p_reason: "TEST" })
    expect((await decide(w.manager, w, "guest_toilets", contribution(a.contributionId), "confirm")).error).toMatchObject({ code: "NLK02" })
    await refused(w.staffA, "knowledge_submit", submitArgs(w, "guest_toilets", { answer: "no" }), "knowledge_slot_out_of_scope", "NLK02")
    expect((await decide(w.manager, w, "guest_toilets", contribution(b.contributionId), "seen")).error).toBeNull()
    expect((await decide(w.manager, w, "guest_toilets", contribution(c.contributionId), "request_detail", "TEST why")).error).toBeNull()
    expect(slot(w.venue, "guest_toilets")).toMatchObject({ reason: "unknown", detail: "not_enabled" })
    const before = slotRevision(w.venue, "guest_toilets")
    await json(w.admin, "knowledge_set_working_list", { p_venue_id: w.venue, p_keys: ["guest_toilets"], p_enabled: true, p_reason: "TEST" })
    expect(slot(w.venue, "guest_toilets")).toMatchObject({ reason: "disputed", detail: "conflict" })
    expect(slotRevision(w.venue, "guest_toilets")).toBeGreaterThan(before)
  })
})

describe("screen reads (S1, S2, S6)", () => {
  it("returns in_scope, the slot revision, sent and saved times, and pending work by audience", async () => {
    const w = await world("kn-screens")
    const r = await yes(w.staffA, w, "step_free_entrance")
    const managerView = await json<Record<string, unknown>>(w.manager, "knowledge_check", { p_check_id: w.checks.step_free_entrance })
    expect(managerView).toMatchObject({ inScope: true, slotRevision: slotRevision(w.venue, "step_free_entrance") })
    expect((managerView.pending as unknown[]).length).toBe(1)
    const staffView = await json<Record<string, unknown>>(w.staffB, "knowledge_check", { p_check_id: w.checks.step_free_entrance })
    expect(staffView).toMatchObject({ pending: [], othersPending: 1, mode: "answer" })
    const queue = await json<{ count: number }>(w.manager, "knowledge_to_confirm", { p_venue_id: w.venue })
    expect(queue.count).toBe(1)
    await call(w.manager, "knowledge_decide", {
      p_target_type: "contribution",
      p_target_id: r.contributionId,
      p_decision: "confirm",
      p_slot_revision: slotRevision(w.venue, "step_free_entrance"),
      p_idempotency_key: randomUUID(),
      p_note: null,
    })
    const s = slot(w.venue, "step_free_entrance")
    expect(new Date(s.sent_at!).getTime()).toBeLessThan(new Date(s.saved_at!).getTime())
    const mine = await json<{ items: { state: string }[] }>(w.staffA, "knowledge_my_contributions", { p_before: null, p_limit: 20 })
    expect(mine.items[0]!.state).toBe("current")
  })
})
