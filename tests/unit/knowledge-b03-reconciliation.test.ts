// B03-f reconciliation (docs/knowledge/b03-design.md §8, A12, A13, A23): the
// admin services' input checks, the suggestions triage summary, and the error
// mapping. Mocked RPC client.
import { describe, expect, it, vi } from "vitest"

import * as knowledge from "@/lib/server/knowledge"
import { knowledgeRpcFailure } from "@/lib/server/knowledge/errors"
import type { MediaActor } from "@/lib/server/media/types"

vi.mock("server-only", () => ({}))

function actorWith(handlers: Record<string, (args: object) => object>) {
  const rpc = vi.fn(async (fn: string, args: object = {}) => {
    const handler = handlers[fn]
    if (!handler) throw new Error(`unexpected rpc ${fn}`)
    const out = handler(args) as { data?: unknown; error?: unknown }
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  return { actor: { db, service: db } as unknown as MediaActor, rpc }
}

const KEY = "11111111-1111-4111-8111-111111111111"
const ID = "22222222-2222-4222-8222-222222222222"
const VENUE = "33333333-3333-4333-8333-333333333333"

describe("sources and imports", () => {
  it("declare a source with a trimmed label, checking kind, label and venue first", async () => {
    const { actor, rpc } = actorWith({
      knowledge_source_declare: () => ({
        data: { sourceId: ID, replayed: false },
      }),
    })
    expect(
      await knowledge.declareSource(actor, {
        kind: "venue_website",
        label: " The Old Crown site ",
        venueId: VENUE,
        idempotencyKey: KEY,
      })
    ).toEqual({ ok: true, sourceId: ID, replayed: false })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_kind: "venue_website",
      p_label: "The Old Crown site",
      p_venue_id: VENUE,
      p_idempotency_key: KEY,
    })
    for (const bad of [
      { kind: "rumour", label: "x", idempotencyKey: KEY },
      { kind: "other", label: " ", idempotencyKey: KEY },
      { kind: "other", label: "x", venueId: "v", idempotencyKey: KEY },
      { kind: "other", label: "x", idempotencyKey: "k" },
    ])
      expect(await knowledge.declareSource(actor, bad)).toMatchObject({
        code: "invalid_input",
      })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("import at most 500 statements for one revision", async () => {
    const { actor, rpc } = actorWith({
      knowledge_source_import: () => ({
        data: { sourceId: ID, imported: 1, replayed: false },
      }),
    })
    const base = {
      sourceId: ID,
      sourceRevision: "rev-1",
      retrievedAt: "2026-11-10T09:00:00Z",
      idempotencyKey: KEY,
    }
    expect(
      await knowledge.importSourceAssertions(actor, {
        ...base,
        assertions: [
          { venueId: VENUE, questionKey: "onsite_parking", headline: "yes" },
        ],
      })
    ).toEqual({ ok: true, imported: 1, replayed: false })
    for (const bad of [
      { ...base, assertions: [] },
      { ...base, assertions: Array.from({ length: 501 }, () => ({})) },
      { ...base, sourceRevision: " ", assertions: [{}] },
      { ...base, retrievedAt: "yesterday", assertions: [{}] },
    ])
      expect(await knowledge.importSourceAssertions(actor, bad)).toMatchObject({
        code: "invalid_input",
      })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe("mappings and runs", () => {
  it("review a mapping with a reason for one revision", async () => {
    const { actor, rpc } = actorWith({
      knowledge_mapping_review: () => ({
        data: { mappingId: ID, replayed: false },
      }),
    })
    const base = {
      legacyFactId: ID,
      legacyRevision: 2,
      questionKey: "guest_toilets",
      kind: "exact",
      reason: "Same meaning",
      idempotencyKey: KEY,
    }
    expect(await knowledge.reviewMapping(actor, base)).toEqual({
      ok: true,
      mappingId: ID,
      replayed: false,
    })
    for (const extra of [
      { kind: "maybe" },
      { reason: "" },
      { legacyRevision: 0 },
      { questionKey: "Toilets" },
    ])
      expect(
        await knowledge.reviewMapping(actor, { ...base, ...extra })
      ).toMatchObject({
        code: "invalid_input",
      })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("run a dry run or an apply for a venue or everywhere", async () => {
    const result = {
      runId: ID,
      mode: "dry_run",
      counts: {},
      conflicts: [],
      sourceRevisions: {},
    }
    const { actor, rpc } = actorWith({
      knowledge_reconcile: () => ({ data: result }),
    })
    expect(
      await knowledge.reconcile(actor, {
        kind: "legacy",
        mode: "dry_run",
        venueId: VENUE,
      })
    ).toEqual({ ok: true, result })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_kind: "legacy",
      p_mode: "dry_run",
      p_venue_id: VENUE,
    })
    expect(
      await knowledge.reconcile(actor, { kind: "web", mode: "apply" })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { kind: expect.any(String) },
    })
  })
})

describe("manager triage (A12)", () => {
  it("adds the suggestions summary beside the B02 queues", async () => {
    const { actor } = actorWith({
      manager_triage_summary: () => ({
        data: [
          {
            queue: "findings",
            available: true,
            waiting: 0,
            oldest_waiting_at: null,
            own_waiting: null,
          },
          {
            queue: "suggestions",
            available: true,
            waiting: 2,
            oldest_waiting_at: "2026-11-10T10:00:00Z",
            own_waiting: null,
          },
        ],
      }),
    })
    expect(await knowledge.getManagerTriage(actor, {})).toMatchObject({
      ok: true,
      suggestions: { available: true, waiting: 2 },
    })
  })
})

describe("reconciliation errors", () => {
  it("map to non-retryable 4xx codes", () => {
    for (const [message, code] of [
      ["reconcile_source_changed", "state_conflict"],
      ["reconcile_dry_run_required", "state_conflict"],
      ["knowledge_source_not_found", "not_found"],
      ["legacy_fact_not_found", "not_found"],
      ["knowledge_run_not_found", "not_found"],
    ] as const)
      expect(
        knowledgeRpcFailure({ code: "P0001", message }, "t")
      ).toMatchObject({ code })
    // A43: NLK14 has its own code and the approved copy (UI §7.1, §10).
    for (const error of [
      { code: "NLK14", message: "x" },
      { code: "P0001", message: "import_slot_has_answer" },
    ])
      expect(knowledgeRpcFailure(error, "t")).toEqual({
        ok: false,
        code: "import_slot_has_answer",
        status: 409,
        message:
          "This import can't be used: this question already has a recorded answer (in use, withdrawn or past its check date). Nothing was changed.",
      })
    expect(
      knowledgeRpcFailure(
        { code: "22023", message: "invalid_source_kind" },
        "t"
      )
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { kind: expect.any(String) },
    })
  })
})

describe("old facts for one question (A44)", () => {
  const ITEM = {
    legacyKey: "toilets",
    label: "Toilets",
    presence: "present",
    facts: "Two cubicles",
    policy: null,
    savedAsConfirmedAt: null,
    updatedAt: "2026-11-01T10:00:00Z",
    mappingKind: "candidate",
  }

  it("sends the question key and venue, refusing a bad key or venue without a call", async () => {
    const { actor, rpc } = actorWith({
      knowledge_legacy_narrative_for_question: () => ({
        data: { venueId: VENUE, questionKey: "guest_toilets", items: [ITEM] },
      }),
    })
    expect(
      await knowledge.getQuestionLegacyNarrative(actor, {
        questionKey: "guest_toilets",
      })
    ).toEqual({
      ok: true,
      venueId: VENUE,
      questionKey: "guest_toilets",
      items: [ITEM],
    })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_question_key: "guest_toilets",
      p_venue_id: null,
    })
    for (const bad of [
      {},
      { questionKey: "Guest Toilets" },
      { questionKey: "guest_toilets", venueId: "v" },
    ])
      expect(
        await knowledge.getQuestionLegacyNarrative(actor, bad)
      ).toMatchObject({ code: "invalid_input" })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("maps an unknown question to not_found", async () => {
    const { actor } = actorWith({
      knowledge_legacy_narrative_for_question: () => ({
        error: { code: "P0002", message: "knowledge_question_not_found" },
      }),
    })
    expect(
      await knowledge.getQuestionLegacyNarrative(actor, {
        questionKey: "no_such_key",
        venueId: VENUE,
      })
    ).toMatchObject({ ok: false, code: "not_found" })
  })
})
