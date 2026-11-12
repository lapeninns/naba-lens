import { randomUUID } from "node:crypto"

import { expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import { call, json, slotRevision, world, yes } from "./knowledge-fixtures"

it("clears optional detail from the current answer and keeps it in history before the correction", async () => {
  const w = await world("kn-b03-clear-detail")
  const key = "guest_toilets"
  const sent = await yes(w.staffA, w, key)
  expect(sent.outcome).toBe("current")
  const original = { availability: { state: "temporarily_unavailable" } }
  // Attach an optional facility detail without changing the shared registry.
  psql(`insert into public.knowledge_contribution_details
    (contribution_id, venue_id, question_version, value_schema, value_schema_version, detail, request_hash)
    values ('${sent.contributionId}', '${w.venue}', 1, 'facility', 1,
      '${JSON.stringify(original)}'::jsonb, repeat('a', 64))`)
  const check = () =>
    json(w.manager, "knowledge_check", { p_check_id: w.checks[key] })
  const history = (at: string) =>
    json(w.manager, "knowledge_slot_history", {
      p_check_id: w.checks[key],
      p_at: at,
    })
  const clear = () =>
    call(w.manager, "knowledge_correct", {
      p_check_id: w.checks[key],
      p_slot_revision: slotRevision(w.venue, key),
      p_idempotency_key: randomUUID(),
      p_headline: "yes",
      p_detail: {},
      p_reason: "TEST cleared an outdated note",
    })

  expect(await check()).toMatchObject({
    status: "unavailable",
    detail: "qualified_answer",
    answerInUse: { detail: original },
  })
  const before = psql("select clock_timestamp()")
  const correction = await clear()
  expect(correction.error).toBeNull()
  expect(correction.data).toMatchObject({ material: false })
  const after = psql("select clock_timestamp()")

  expect(await check()).toMatchObject({
    status: "available",
    answerInUse: { detail: null, qualified: null },
  })
  expect(await history(before)).toMatchObject({
    answerInUse: { submissionId: sent.submissionId, detail: original },
  })
  expect(await history(after)).toMatchObject({
    answerInUse: { submissionId: sent.submissionId, detail: null },
  })
  expect((await clear()).error?.message).toBe("nothing_to_correct")
})
