// Venue transfer and lock order (docs/knowledge/b01-design.md §4.4, §7, §17
// T10 and T16), with sessions held open in psql as signed-in users.
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
  service,
  sessionAs,
  sleep,
  slot,
  slotRevision,
  submit,
  submitArgs,
  world,
  yes,
} from "./knowledge-fixtures"

function submitSql(args: Record<string, unknown>) {
  const lit = (v: unknown) =>
    v === null || v === undefined
      ? "null"
      : Array.isArray(v)
        ? (v.length ? `array['${v.join("','")}']::uuid[]` : "'{}'::uuid[]")
        : typeof v === "boolean" || typeof v === "number"
          ? String(v)
          : typeof v === "object"
            ? `'${JSON.stringify(v)}'::jsonb`
            : `'${String(v).replace(/'/g, "''")}'`
  const order = [
    "p_check_id", "p_slot_revision", "p_idempotency_key", "p_kind", "p_answer", "p_finding",
    "p_limitations", "p_reason", "p_unknown_preset", "p_tried_text", "p_change_reason",
    "p_responds_to", "p_asset_ids", "p_internal_metadata", "p_redaction_confirmed", "p_confirm_own",
  ]
  return `select public.knowledge_submit(${order.map((k) => lit(args[k])).join(", ")});`
}

describe("venue transfer during a contribution (T10)", () => {
  it("records a contribution committed before the transfer at the old venue", async () => {
    const w = await world("kn-move-a")
    const to = await world("kn-move-a-to")
    const args = submitArgs(w, "guest_toilets", { answer: "no" })
    const sending = sessionAs(w.staffA.id, `${submitSql(args)}\nselect pg_sleep(1.5);`)
    await sleep(400)
    const started = Date.now()
    await ok(service.from("profiles").update({ venue_id: to.venue }).eq("id", w.staffA.id))
    expect(Date.now() - started).toBeGreaterThan(700)
    const result = await sending
    expect(result.code, result.err).toBe(0)
    expect(psql(`select venue_id from public.knowledge_contributions where idempotency_key = '${args.p_idempotency_key}'`)).toBe(w.venue)
    expect(slot(w.venue, "guest_toilets").value).toBe("no")
    expect(slot(to.venue, "guest_toilets").current_answer).toBeNull()
  })

  it("refuses a contribution that waited behind the transfer, at either venue", async () => {
    const w = await world("kn-move-b")
    const to = await world("kn-move-b-to")
    const args = submitArgs(w, "guest_toilets", { answer: "no" })
    const moving = sessionAs(w.admin.id, `select 1 from public.profiles where id = '${w.staffA.id}' for update;
      update public.profiles set venue_id = '${to.venue}' where id = '${w.staffA.id}';
      select pg_sleep(1.5);`)
    await sleep(400)
    const { error } = await call(w.staffA, "knowledge_submit", args)
    expect((await moving).code).toBe(0)
    expect(error?.message).toBe("amenity_check_not_found")
    expect(count(`select count(*) from public.knowledge_contributions where idempotency_key = '${args.p_idempotency_key}'`)).toBe(0)
  })

  it("keeps evidence and drafts at the old venue and history readable", async () => {
    const w = await world("kn-move-c")
    const to = await world("kn-move-c-to")
    const oldPhoto = await photo(w.staffA.id, w.venue)
    const sent = await submit(w.staffA, w, "guest_toilets", { answer: "unknown" })
    await json(w.staffA, "knowledge_save_draft", {
      p_check_id: w.checks.onsite_parking,
      p_draft_revision: null,
      p_payload: { answer: "yes" },
      p_asset_ids: [oldPhoto],
      p_idempotency_key: randomUUID(),
    })
    await ok(service.from("profiles").update({ venue_id: to.venue }).eq("id", w.staffA.id))
    const e = await refused(w.staffA, "knowledge_submit", submitArgs(to, "onsite_parking", { assets: [oldPhoto] }), "evidence_not_eligible")
    expect(JSON.parse(e.details!)).toMatchObject({ reason: "not_found" })
    await refused(w.staffA, "knowledge_submit", submitArgs(w, "onsite_parking", { answer: "no" }), "amenity_check_not_found")
    const draft = await json<{ sendable: boolean }>(w.staffA, "knowledge_get_draft", { p_check_id: w.checks.onsite_parking })
    expect(draft.sendable).toBe(false)
    const history = await json<{ items: { findingRef: { id: string }; venueId: string }[] }>(w.staffA, "knowledge_my_contributions", { p_cursor: null, p_limit: 20 })
    expect(history.items.map((i) => i.findingRef.id)).toContain(sent.contributionId)
    expect(JSON.stringify(history)).not.toContain("internal_metadata")
  })
})

describe("lock order between adoption and evidence deletion (T16)", () => {
  it("refuses adoption after a deletion that committed first", async () => {
    const w = await world("kn-lock-a")
    const r = await yes(w.staffA, w, "step_free_entrance")
    const asset = psql(`select asset_id from public.knowledge_contribution_assets where contribution_id = '${r.contributionId}'`)
    const deleting = sessionAs(w.staffA.id, `set local role postgres;
      update public.media_assets set deleted_at = now() where id = '${asset}';
      select pg_sleep(1.5);`)
    await sleep(400)
    const res = await decide(w.manager, w, "step_free_entrance", { type: "contribution", id: r.contributionId }, "confirm")
    expect((await deleting).code).toBe(0)
    expect(res.error?.message).toBe("evidence_not_eligible")
    expect(slot(w.venue, "step_free_entrance").current_submission_id).toBeNull()
  })

  it("lets a deletion waiting behind an adoption finish without deadlock, then make it stale", async () => {
    const w = await world("kn-lock-b")
    const r = await yes(w.staffA, w, "step_free_entrance")
    const asset = psql(`select asset_id from public.knowledge_contribution_assets where contribution_id = '${r.contributionId}'`)
    const adopting = sessionAs(w.manager.id, `select public.knowledge_decide('contribution', '${r.contributionId}', 'confirm',
      ${slotRevision(w.venue, "step_free_entrance")}, gen_random_uuid(), null);
      select pg_sleep(1.5);`)
    await sleep(400)
    psql(`update public.media_assets set deleted_at = now() where id = '${asset}'`)
    const result = await adopting
    expect(result.code, result.err).toBe(0)
    expect(slot(w.venue, "step_free_entrance")).toMatchObject({ reason: "stale", detail: "evidence_lost" })
  })
})
