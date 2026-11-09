// T14c (docs/knowledge/b01-design.md §4.1, §17): every knowledge refusal maps
// to a non-retryable 4xx code in both mappers, never to `unavailable` (which
// the capture form retries), plus the knowledge services' request shapes.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { KNOWLEDGE_SQLSTATES } from "@/lib/knowledge/contract"
import { amenityRpcFailure } from "@/lib/server/amenities/errors"
import * as knowledge from "@/lib/server/knowledge"
import { knowledgeRpcFailure } from "@/lib/server/knowledge/errors"
import {
  parseKnowledgeSubmit,
  parseResolve,
} from "@/lib/server/knowledge/validate"
import type { MediaActor } from "@/lib/server/media/types"

const CHECK = "33333333-3333-4333-8333-333333333333"
const KEY = "77777777-7777-4777-8777-777777777777"
const CONTRIBUTION = "88888888-8888-4888-8888-888888888888"
const VENUE = "11111111-1111-4111-8111-111111111111"

const retryable = (() => {
  const source = readFileSync(
    join(process.cwd(), "components/nabalens/amenities/capture/capture-form.tsx"),
    "utf8"
  )
  const match = /RETRYABLE\s*=\s*new Set(?:<[^>]*>)?\(\[([^\]]*)\]\)/.exec(source)
  if (!match) throw new Error("RETRYABLE set not found in capture-form.tsx")
  return new Set([...match[1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))
})()

const silence = () => vi.spyOn(console, "error").mockImplementation(() => {})

afterEach(() => vi.restoreAllMocks())

describe("NL-class refusals (T14c)", () => {
  const sqlstates = [...Object.keys(KNOWLEDGE_SQLSTATES), "NLK09", "NLKZZ"]

  it.each(sqlstates)("%s is a non-retryable 4xx by SQLSTATE in both mappers", (code) => {
    const log = silence()
    for (const map of [amenityRpcFailure, knowledgeRpcFailure]) {
      const f = map({ code, message: "something new" }, "test")
      expect(f.code).not.toBe("unavailable")
      expect(f.status).toBeGreaterThanOrEqual(400)
      expect(f.status).toBeLessThan(500)
      expect(retryable.has(f.code)).toBe(false)
    }
    expect(log).not.toHaveBeenCalled()
  })

  it.each(Object.entries(KNOWLEDGE_SQLSTATES))("%s / %s maps by message too", (code, message) => {
    for (const sqlstate of [code, "P0001"]) {
      const f = knowledgeRpcFailure({ code: sqlstate, message }, "test")
      expect(f.code).not.toBe("unavailable")
      expect(f.status).toBeLessThan(500)
    }
  })

  it("names the two codes the legacy capture form receives", () => {
    expect(amenityRpcFailure({ code: "NLK01", message: "knowledge_path_required" }, "t")).toMatchObject({
      code: "knowledge_path_required",
      status: 409,
    })
    expect(amenityRpcFailure({ code: "NLK02", message: "knowledge_slot_out_of_scope" }, "t")).toMatchObject({
      code: "knowledge_slot_out_of_scope",
      status: 409,
    })
    expect(
      amenityRpcFailure({ code: "NLK01", message: "knowledge_path_required" }, "t").message
    ).not.toMatch(/try again/i)
    expect(amenityRpcFailure({ code: "NLK77", message: "x" }, "t").code).toBe("state_conflict")
  })

  it("maps the knowledge-only codes per §4.1", () => {
    const cases: [string, string, string, number][] = [
      ["NLK02", "knowledge_slot_out_of_scope", "knowledge_slot_out_of_scope", 409],
      ["NLK03", "already_decided", "already_decided", 409],
      ["NLK04", "self_confirmation_not_permitted", "self_confirmation_not_permitted", 403],
      ["NLK05", "draft_conflict", "draft_conflict", 409],
      ["NLK06", "knowledge_venue_not_found", "not_found", 404],
      ["NLK07", "knowledge_not_adoptable", "state_conflict", 409],
      ["NLK08", "knowledge_not_current", "state_conflict", 409],
    ]
    for (const [code, message, mapped, status] of cases) {
      expect(knowledgeRpcFailure({ code, message }, "t")).toMatchObject({ code: mapped, status })
    }
    expect(
      knowledgeRpcFailure({ code: "NLK05", message: "draft_conflict", details: '{"draftRevision": 4}' }, "t")
    ).toMatchObject({ draftRevision: 4 })
  })

  it("keeps the existing shared mappings", () => {
    expect(
      knowledgeRpcFailure({ code: "P0001", message: "amenity_conflict", details: '{"revision": 9}' }, "t")
    ).toMatchObject({ code: "revision_conflict", currentRevision: 9 })
    expect(knowledgeRpcFailure({ code: "P0001", message: "idempotency_key_reused" }, "t").code).toBe("state_conflict")
    expect(knowledgeRpcFailure({ code: "42501", message: "not_venue_manager" }, "t").code).toBe("not_permitted")
    expect(knowledgeRpcFailure({ code: "P0001", message: "tried_text_required" }, "t")).toMatchObject({
      code: "invalid_input",
      fieldErrors: { triedText: expect.any(String) },
    })
    silence()
    expect(knowledgeRpcFailure({ code: "XX000", message: "boom" }, "t").code).toBe("unavailable")
  })
})

type Handler = (args: Record<string, unknown>) => { data?: unknown; error?: object }

function actorWith(handlers: Record<string, Handler>) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[fn]
    if (!handler) throw new Error(`unexpected rpc ${fn}`)
    const out = handler(args)
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  return { actor: { db, service: db } as unknown as MediaActor, rpc }
}

describe("knowledge services", () => {
  it("sends a Couldn't establish finding and returns a findingRef", async () => {
    const { actor, rpc } = actorWith({
      knowledge_submit: () => ({
        data: {
          contributionId: CONTRIBUTION,
          submissionId: null,
          outcome: "recorded",
          replacedOwn: null,
          slotRevision: 4,
          replayed: false,
          recognition: { kind: "not_scored" },
        },
      }),
    })
    const out = await knowledge.submitKnowledgeFinding(actor, {
      checkId: CHECK,
      slotRevision: 3,
      idempotencyKey: KEY,
      answer: "unknown",
      unknownPreset: "could_not_access",
      triedText: "  Asked the duty manager  ",
    })
    expect(out).toMatchObject({
      ok: true,
      findingRef: { type: "contribution", id: CONTRIBUTION },
      outcome: "recorded",
      slotRevision: 4,
    })
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_kind: "finding",
      p_answer: "unknown",
      p_unknown_preset: "could_not_access",
      p_tried_text: "Asked the duty manager",
      p_slot_revision: 3,
      p_confirm_own: false,
      p_redaction_confirmed: null,
    })
  })

  it("refuses incomplete input before calling the database", async () => {
    const base = { checkId: CHECK, slotRevision: 0, idempotencyKey: KEY }
    expect(parseKnowledgeSubmit({ ...base, answer: "unknown" })).toMatchObject({
      ok: false,
      fieldErrors: { unknownPreset: expect.any(String), triedText: expect.any(String) },
    })
    expect(parseKnowledgeSubmit({ ...base, answer: "no" })).toMatchObject({
      fieldErrors: { reason: "Enter a reason." },
    })
    expect(parseKnowledgeSubmit({ ...base, answer: "yes", kind: "change_report" })).toMatchObject({
      fieldErrors: { changeReason: expect.any(String) },
    })
    expect(parseKnowledgeSubmit({ ...base, answer: "yes", kind: "detail" })).toMatchObject({
      fieldErrors: { respondsTo: expect.any(String) },
    })
    expect(parseKnowledgeSubmit({ ...base, slotRevision: -1, answer: "yes" })).toMatchObject({
      code: "invalid_input",
    })
    expect(parseResolve({ ...base, choose: "keep_in_use", reason: "Kept" })).toMatchObject({
      ok: true,
      value: { choose: null },
    })
    expect(
      parseResolve({ ...base, choose: { type: "submission", id: CONTRIBUTION }, reason: "x" })
    ).toMatchObject({ ok: false })
    const { actor, rpc } = actorWith({})
    expect(
      await knowledge.requestMoreDetail(actor, {
        findingRef: { type: "contribution", id: CONTRIBUTION },
        slotRevision: 2,
        idempotencyKey: KEY,
      })
    ).toMatchObject({ code: "invalid_input", fieldErrors: { note: "Enter a reason." } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("maps a decision refusal without retrying", async () => {
    const { actor } = actorWith({
      knowledge_decide: () => ({ error: { code: "NLK04", message: "self_confirmation_not_permitted" } }),
    })
    expect(
      await knowledge.confirmFinding(actor, {
        findingRef: { type: "contribution", id: CONTRIBUTION },
        slotRevision: 2,
        idempotencyKey: KEY,
      })
    ).toMatchObject({ ok: false, code: "self_confirmation_not_permitted", status: 403 })
  })
})

describe("readKnowledgeAnswers", () => {
  it("passes an empty key list through and reports an unknown venue", async () => {
    const calls: unknown[] = []
    const { actor } = actorWith({
      knowledge_reader_answers_v1: (args) => {
        calls.push(args)
        return args.p_venue_id === VENUE
          ? { data: [] }
          : { error: { code: "NLK06", message: "knowledge_venue_not_found" } }
      },
    })
    expect(await knowledge.readKnowledgeAnswers(actor.service, VENUE, [])).toEqual({ ok: true, rows: [] })
    expect(await knowledge.readKnowledgeAnswers(actor.service, CHECK, [])).toEqual({
      ok: false,
      code: "venue_not_found",
    })
    expect(calls[0]).toEqual({ p_venue_id: VENUE, p_keys: [] })
    const many = Array.from({ length: 51 }, (_, i) => `k${i}`)
    expect(await knowledge.readKnowledgeAnswers(actor.service, VENUE, many)).toEqual({
      ok: false,
      code: "invalid_input",
    })
    expect(calls).toHaveLength(2)
  })
})
