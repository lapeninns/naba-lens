// The reader entry point (docs/knowledge/b01-design.md §5.3, §17 T6 and T6e).
import { describe, expect, it } from "vitest"

import { createVenue } from "../support/identities"
import { psql } from "./coverage-fixtures"
import {
  call,
  json,
  refused,
  service,
  submit,
  yes,
  world,
} from "./knowledge-fixtures"

type Answer = Record<string, unknown> & { question_key: string; status: string }

function read(venue: string | null, keys: string[] | null) {
  return call({ client: service }, "knowledge_reader_answers_v1", {
    p_venue_id: venue,
    p_keys: keys,
  })
}

describe("knowledge_reader_answers_v1 (T6)", () => {
  it("returns only allowlisted fields, in request order, and no staff data", async () => {
    const w = await world("kn-reader")
    await yes(w.staffA, w, "onsite_parking", {
      finding: "TEST car park",
      limitations: "TEST gravel",
    })
    await yes(w.staffA, w, "guest_wifi", {
      finding: "TEST password is hunter2",
    })
    await submit(w.staffB, w, "guest_toilets", { answer: "unknown" })
    const { data, error } = await read(w.venue, [
      "guest_wifi",
      "onsite_parking",
      "guest_toilets",
      "darts",
    ])
    expect(error).toBeNull()
    const rows = data as Answer[]
    expect(rows.map((r) => r.question_key)).toEqual([
      "guest_wifi",
      "onsite_parking",
      "guest_toilets",
      "darts",
    ])
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        "question_key",
        "status",
        "reason",
        "detail",
        "revision",
        "question_version",
        "value",
        "finding",
        "limitations",
        "reason_text",
        "source_basis",
        "current_contribution_id",
        "current_submission_id",
        "contribution_kind",
        "confirmation_required",
        "confirmation_state",
        "confirmation_basis",
        "confirmation_self",
        "confirmation_saved_at",
        "evidence_photos",
        "evidence_videos",
        "redaction_proof",
        "saved_at",
        "observed_at",
        "next_check_due",
        "freshness_state",
        // B03 WS5 item 2: an import's origin, null for any other answer.
        "source_origin",
      ].sort()
    )
    expect(rows[0]).toMatchObject({
      status: "available",
      value: "yes",
      finding: null,
      redaction_proof: "recorded",
      source_origin: null,
    })
    expect(rows[1]).toMatchObject({
      status: "available",
      finding: "TEST car park",
      limitations: "TEST gravel",
      contribution_kind: "contribution",
      observed_at: null,
    })
    expect(rows[2]).toMatchObject({
      status: "unavailable",
      reason: "unknown",
      detail: "unable_to_establish",
      value: null,
      current_contribution_id: null,
    })
    expect(rows[3]).toMatchObject({
      status: "unavailable",
      reason: "unknown",
      detail: "not_enabled",
    })
    const body = JSON.stringify(rows)
    for (const secret of [
      "hunter2",
      w.staffA.id,
      w.staffB.id,
      w.staffA.email,
      "TEST kn-reader",
    ]) {
      expect(body).not.toContain(secret)
    }
  })

  it("is refused to signed-in users", async () => {
    const w = await world("kn-reader-auth")
    const { error } = await call(w.admin, "knowledge_reader_answers_v1", {
      p_venue_id: w.venue,
      p_keys: ["guest_toilets"],
    })
    expect(error?.code).toBe("42501")
  })

  it("accepts an empty or missing key list and still checks the venue (T6e)", async () => {
    const w = await world("kn-reader-empty")
    for (const keys of [[], null]) {
      const { data, error } = await read(w.venue, keys)
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
    const inactive = await createVenue(service, "kn-reader-inactive", false)
    const noScope = await world("kn-reader-noscope", { enable: false })
    for (const venue of [
      crypto.randomUUID(),
      inactive.id,
      noScope.venue,
      null,
    ]) {
      for (const keys of [[], null, ["guest_toilets"]]) {
        await refused(
          { client: service },
          "knowledge_reader_answers_v1",
          { p_venue_id: venue, p_keys: keys },
          "knowledge_venue_not_found",
          "NLK06"
        )
      }
    }
    // A venue taken off the working list entirely is not found either.
    await json(w.admin, "knowledge_set_working_list", {
      p_venue_id: w.venue,
      p_keys: [
        "onsite_parking",
        "step_free_entrance",
        "guest_toilets",
        "guest_wifi",
      ],
      p_enabled: false,
      p_reason: "TEST",
    })
    await refused(
      { client: service },
      "knowledge_reader_answers_v1",
      { p_venue_id: w.venue, p_keys: [] },
      "knowledge_venue_not_found",
      "NLK06"
    )
    expect(psql("select 1")).toBe("1")
  })
})
