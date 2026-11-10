// B03-b places and structured detail (docs/knowledge/b03-design.md §4, A2,
// A20): the places services' input checks, the submit extras that select the
// 19-argument knowledge_submit, and the error mapping. Mocked RPC client.
import { describe, expect, it, vi } from "vitest"

import * as knowledge from "@/lib/server/knowledge"
import { knowledgeRpcFailure } from "@/lib/server/knowledge/errors"
import { parseKnowledgeSubmit } from "@/lib/server/knowledge/validate"
import { londonToday, safeDate } from "@/lib/server/knowledge/values"
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
const PLACE = "22222222-2222-4222-8222-222222222222"
const VENUE = "33333333-3333-4333-8333-333333333333"
const CHECK = "44444444-4444-4444-8444-444444444444"

describe("places", () => {
  it("lists the caller's venue, or the one an admin names", async () => {
    const items = [
      { subjectId: PLACE, kind: "entrance", label: "Main door", active: true },
    ]
    const { actor, rpc } = actorWith({
      knowledge_subjects: () => ({ data: { venueId: VENUE, items } }),
    })
    expect(await knowledge.listPlaces(actor, {})).toEqual({
      ok: true,
      venueId: VENUE,
      places: items,
    })
    await knowledge.listPlaces(actor, { venueId: VENUE })
    expect(rpc.mock.calls.map((c) => c[1])).toEqual([
      { p_venue_id: null },
      { p_venue_id: VENUE },
    ])
    expect(await knowledge.listPlaces(actor, { venueId: "x" })).toMatchObject({
      code: "invalid_input",
    })
  })

  it("adds a place with a trimmed label, checking kind, label and key first", async () => {
    const { actor, rpc } = actorWith({
      knowledge_subject_add: () => ({
        data: { subjectId: PLACE, replayed: false },
      }),
    })
    expect(
      await knowledge.addPlace(actor, {
        kind: "entrance",
        label: "  Main door ",
        idempotencyKey: KEY,
      })
    ).toEqual({ ok: true, subjectId: PLACE, replayed: false })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_venue_id: null,
      p_kind: "entrance",
      p_label: "Main door",
      p_idempotency_key: KEY,
    })
    for (const bad of [
      { kind: "door", label: "Main door", idempotencyKey: KEY },
      { kind: "entrance", label: "   ", idempotencyKey: KEY },
      { kind: "entrance", label: "x".repeat(81), idempotencyKey: KEY },
      { kind: "entrance", label: "Main door", idempotencyKey: "k" },
      null,
    ])
      expect(await knowledge.addPlace(actor, bad)).toMatchObject({
        code: "invalid_input",
      })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("offers the existing place when one with the same kind and label is active", async () => {
    const { actor } = actorWith({
      knowledge_subject_add: () => ({
        error: {
          code: "NLK13",
          message: "place_exists",
          details: JSON.stringify({ subjectId: PLACE }),
        },
      }),
    })
    expect(
      await knowledge.addPlace(actor, {
        kind: "entrance",
        label: "main door",
        idempotencyKey: KEY,
      })
    ).toMatchObject({ code: "state_conflict", status: 409, subjectId: PLACE })
  })

  it("retires a place with a reason", async () => {
    const { actor, rpc } = actorWith({
      knowledge_subject_retire: () => ({
        data: { subjectId: PLACE, retired: true, replayed: false },
      }),
    })
    expect(
      await knowledge.retirePlace(actor, {
        subjectId: PLACE,
        reason: " Bricked up ",
        idempotencyKey: KEY,
      })
    ).toEqual({ ok: true, subjectId: PLACE, replayed: false })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_subject_id: PLACE,
      p_reason: "Bricked up",
      p_idempotency_key: KEY,
    })
    expect(
      await knowledge.retirePlace(actor, {
        subjectId: "x",
        reason: "r",
        idempotencyKey: KEY,
      })
    ).toMatchObject({ code: "not_found" })
    expect(
      await knowledge.retirePlace(actor, {
        subjectId: PLACE,
        reason: " ",
        idempotencyKey: KEY,
      })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { reason: expect.any(String) },
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe("submit with detail and observation date", () => {
  const NOW = new Date("2026-11-10T12:00:00Z")
  const base = {
    checkId: CHECK,
    slotRevision: 3,
    idempotencyKey: KEY,
    answer: "yes",
  }

  it("leaves the extras out when none is sent (the 16-argument call)", () => {
    const parsed = parseKnowledgeSubmit(base, NOW)
    expect(parsed.ok && parsed.value).not.toHaveProperty("detail")
  })

  it("accepts detail with a date from today to 30 days back, both date fields together", () => {
    const detail = { scope: { label: "Main door" } }
    expect(
      parseKnowledgeSubmit(
        {
          ...base,
          detail,
          observedOn: "2026-10-11",
          observedOnSource: "chosen",
        },
        NOW
      )
    ).toMatchObject({
      ok: true,
      value: { detail, observedOn: "2026-10-11", observedOnSource: "chosen" },
    })
    expect(parseKnowledgeSubmit({ ...base, detail: null }, NOW)).toMatchObject({
      ok: true,
      value: { detail: null, observedOn: null, observedOnSource: null },
    })
    for (const [extra, field] of [
      [{ observedOn: "2026-10-10", observedOnSource: "chosen" }, "observedOn"],
      [{ observedOn: "2026-11-11", observedOnSource: "chosen" }, "observedOn"],
      [{ observedOn: "2026-02-30", observedOnSource: "chosen" }, "observedOn"],
      [{ observedOn: "2026-11-10" }, "observedOnSource"],
      [{ observedOnSource: "form_default" }, "observedOn"],
      [
        { observedOn: "2026-11-10", observedOnSource: "guessed" },
        "observedOnSource",
      ],
      [{ detail: [1] }, "detail"],
      [{ detail: { notes: "x".repeat(17000) } }, "detail"],
    ] as const)
      expect(parseKnowledgeSubmit({ ...base, ...extra }, NOW)).toMatchObject({
        code: "invalid_input",
        fieldErrors: { [field]: expect.any(String) },
      })
  })

  it("sends all three extras to knowledge_submit only when given", async () => {
    const { actor, rpc } = actorWith({
      knowledge_submit: () => ({
        data: {
          contributionId: KEY,
          submissionId: null,
          outcome: "recorded",
          replacedOwn: null,
          replacedOwnSentAt: null,
          slotRevision: 4,
          replayed: false,
          recognition: { kind: "none" },
          detail: null,
          observedOn: "2026-11-10",
          rechecksClosed: [],
        },
      }),
    })
    const sent = await knowledge.submitKnowledgeFinding(actor, {
      ...base,
      observedOn: londonToday(new Date()),
      observedOnSource: "form_default",
    })
    expect(sent).toMatchObject({
      ok: true,
      findingRef: { type: "contribution", id: KEY },
      rechecksClosed: [],
    })
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_detail: null,
      p_observed_on: londonToday(new Date()),
      p_observed_on_source: "form_default",
    })
    await knowledge.submitKnowledgeFinding(actor, base)
    expect(rpc.mock.calls[1]![1]).not.toHaveProperty("p_detail")
  })
})

describe("dates", () => {
  it("reads only real calendar dates, as Postgres does", () => {
    expect(safeDate("2024-02-29")).toBe("2024-02-29")
    for (const bad of [
      "2026-02-29",
      "2026-13-01",
      "2026-04-31",
      "0000-01-01",
      "2026-1-01",
      20261110,
    ])
      expect(safeDate(bad)).toBeNull()
    expect(londonToday(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01")
  })
})

describe("place and detail errors", () => {
  it("map to non-retryable 4xx codes with fields", () => {
    expect(
      knowledgeRpcFailure(
        { code: "P0002", message: "knowledge_subject_not_found" },
        "t"
      )
    ).toMatchObject({ code: "not_found", status: 404 })
    expect(
      knowledgeRpcFailure({ code: "22023", message: "invalid_place_kind" }, "t")
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { kind: expect.any(String) },
    })
    expect(
      knowledgeRpcFailure({ code: "22023", message: "invalid_label" }, "t")
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { label: expect.any(String) },
    })
    expect(
      knowledgeRpcFailure(
        {
          code: "22023",
          message: "invalid_value",
          details: JSON.stringify({
            fields: [
              { path: "detail.entrances", problem: "no_entrances_listed" },
              { path: "observedOn", problem: "out_of_range" },
            ],
          }),
        },
        "t"
      )
    ).toMatchObject({
      code: "invalid_input",
      status: 400,
      fieldErrors: {
        "detail.entrances": expect.stringContaining("Places"),
        observedOn: expect.any(String),
      },
    })
  })
})
