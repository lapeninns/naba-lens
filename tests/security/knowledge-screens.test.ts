// Screen DTO fields WS2 needs (docs/knowledge/b01-design.md §13): the
// confirmer on the answer in use and the detail request on a pending finding
// (managers and admins only), the replaced own finding's send time, whether a
// finding disputes the answer in use, and each draft's question and venue.
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { json, slotRevision, submit, world, yes } from "./knowledge-fixtures"

type Answer = Record<string, unknown> | null
type Pending = {
  findingRef: { id: string }
  detailRequest: Record<string, unknown> | null
}
type Check = { answerInUse: Answer; pending: Pending[] }

describe("decider-only fields", () => {
  it("shows the detail request and the confirmer to managers, never to staff", async () => {
    const w = await world("kn-dto-decider")
    const first = await yes(w.staffA, w, "step_free_entrance")
    const asked = await json<{ decisionId: string }>(
      w.manager,
      "knowledge_decide",
      {
        p_target_type: "contribution",
        p_target_id: first.contributionId,
        p_decision: "request_detail",
        p_slot_revision: slotRevision(w.venue, "step_free_entrance"),
        p_idempotency_key: randomUUID(),
        p_note: "TEST which door?",
      }
    )
    const check = { p_check_id: w.checks.step_free_entrance }
    const managerView = await json<Check>(w.manager, "knowledge_check", check)
    expect(managerView.pending[0]!.detailRequest).toEqual({
      decisionId: asked.decisionId,
      note: "TEST which door?",
      requestedAt: expect.any(String),
    })
    const ownView = await json<Check>(w.staffA, "knowledge_check", check)
    expect(ownView.pending[0]!.detailRequest).toBeNull()

    const detail = await yes(w.staffA, w, "step_free_entrance", {
      kind: "detail",
      respondsTo: asked.decisionId,
    })
    await json(w.manager, "knowledge_decide", {
      p_target_type: "contribution",
      p_target_id: detail.contributionId,
      p_decision: "confirm",
      p_slot_revision: slotRevision(w.venue, "step_free_entrance"),
      p_idempotency_key: randomUUID(),
      p_note: null,
    })
    const confirmed = await json<Check>(w.manager, "knowledge_check", check)
    expect(confirmed.answerInUse).toMatchObject({
      confirmed: true,
      confirmedByFirstName: expect.any(String),
      confirmedAt: expect.any(String),
      confirmedSelf: false,
    })
    const staffView = await json<Check>(w.staffB, "knowledge_check", check)
    expect(staffView.answerInUse).toMatchObject({ confirmed: true })
    for (const key of [
      "confirmedByFirstName",
      "confirmedAt",
      "confirmedSelf",
    ]) {
      expect(staffView.answerInUse).not.toHaveProperty(key)
    }
    const list = await json<{ items: { answerInUse: Answer }[] }>(
      w.staffB,
      "knowledge_working_list"
    )
    expect(JSON.stringify(list)).not.toContain("confirmedByFirstName")

    // A manager's self-confirmed answer says so.
    const own = await yes(w.manager, w, "step_free_entrance", {
      confirmOwn: true,
    })
    expect(own.outcome).toBe("current")
    expect(
      (await json<Check>(w.manager, "knowledge_check", check)).answerInUse
    ).toMatchObject({
      confirmedSelf: true,
    })
  })
})

describe("staff-visible additions", () => {
  it("returns when a replaced own finding was sent", async () => {
    const w = await world("kn-dto-replaced")
    const first = await submit(w.staffA, w, "guest_toilets", {
      answer: "unknown",
    })
    const second = await submit(w.staffA, w, "guest_toilets", {
      answer: "unknown",
      preset: "could_not_access",
    })
    expect(second).toMatchObject({
      replacedOwn: first.contributionId,
      replacedOwnSentAt: expect.any(String),
    })
    const fresh = await submit(w.staffB, w, "onsite_parking", {
      answer: "unknown",
    })
    expect(fresh).toMatchObject({ replacedOwn: null, replacedOwnSentAt: null })
  })

  it("marks the findings that dispute the answer in use", async () => {
    const w = await world("kn-dto-disputes")
    await submit(w.staffB, w, "guest_toilets", { answer: "no" })
    const report = await submit(w.staffA, w, "guest_toilets", {
      kind: "change_report",
      answer: "unknown",
    })
    const pending = await yes(w.staffA, w, "step_free_entrance")
    const queue = await json<{
      items: { findingRef: { id: string }; disputes: boolean }[]
    }>(w.manager, "knowledge_to_confirm", { p_venue_id: w.venue })
    const of = (id: string) => queue.items.find((i) => i.findingRef.id === id)
    expect(of(report.contributionId)).toMatchObject({ disputes: true })
    expect(of(pending.contributionId)).toMatchObject({ disputes: false })
  })

  it("names each draft's question and venue", async () => {
    const w = await world("kn-dto-drafts")
    await json(w.staffA, "knowledge_save_draft", {
      p_check_id: w.checks.onsite_parking,
      p_draft_revision: null,
      p_payload: { answer: "yes" },
      p_asset_ids: [],
      p_idempotency_key: randomUUID(),
    })
    const page = await json<{ drafts: Record<string, unknown>[] }>(
      w.staffA,
      "knowledge_my_contributions",
      {
        p_cursor: null,
        p_limit: 20,
      }
    )
    expect(page.drafts).toEqual([
      expect.objectContaining({
        checkId: w.checks.onsite_parking,
        venueName: w.venueName,
        questionKey: "onsite_parking",
        question: expect.any(String),
      }),
    ])
  })
})
