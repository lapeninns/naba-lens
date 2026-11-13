// B03-g corrections and history (docs/knowledge/b03-design.md §9, A15, A16):
// the services' input checks and the error mapping. Mocked RPC client.
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

const CHECK = "44444444-4444-4444-8444-444444444444"
const KEY = "11111111-1111-4111-8111-111111111111"

describe("correct and withdraw (§9.1, §9.2)", () => {
  it("send a correction with its reason, checking the headline first", async () => {
    const result = {
      decisionId: KEY,
      material: true,
      submissionId: KEY,
      slotRevision: 9,
      replayed: false,
      rechecksClosed: [],
    }
    const { actor, rpc } = actorWith({
      knowledge_correct: () => ({ data: result }),
    })
    const base = {
      checkId: CHECK,
      slotRevision: 8,
      idempotencyKey: KEY,
      reason: " Closed for good ",
    }
    expect(
      await knowledge.correctAnswer(actor, { ...base, headline: "no" })
    ).toEqual({
      ok: true,
      ...result,
    })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_check_id: CHECK,
      p_slot_revision: 8,
      p_idempotency_key: KEY,
      p_headline: "no",
      p_detail: null,
      p_reason: "Closed for good",
    })
    for (const extra of [
      { headline: "unknown" },
      { headline: "no", reason: " " },
      { headline: "no", detail: [1] },
      { headline: "no", slotRevision: -1 },
    ])
      expect(
        await knowledge.correctAnswer(actor, { ...base, ...extra })
      ).toMatchObject({
        code: "invalid_input",
      })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("withdraw with a reason", async () => {
    const { actor, rpc } = actorWith({
      knowledge_withdraw: () => ({
        data: { decisionId: KEY, slotRevision: 3, replayed: false },
      }),
    })
    expect(
      await knowledge.withdrawAnswer(actor, {
        checkId: CHECK,
        slotRevision: 2,
        idempotencyKey: KEY,
        reason: "Car park closed",
      })
    ).toEqual({ ok: true, decisionId: KEY, slotRevision: 3, replayed: false })
    expect(
      await knowledge.withdrawAnswer(actor, {
        checkId: CHECK,
        slotRevision: 2,
        idempotencyKey: KEY,
      })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { reason: expect.any(String) },
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe("history and events (§9.4, A16)", () => {
  it("read history at a time and page events by cursor", async () => {
    const { actor, rpc } = actorWith({
      knowledge_slot_history: () => ({
        data: { checkId: CHECK, at: "x", answerInUse: null },
      }),
      knowledge_slot_events: () => ({ data: { items: [], nextCursor: null } }),
    })
    expect(
      await knowledge.getSlotHistory(actor, {
        checkId: CHECK,
        at: "2026-11-10T10:00:00Z",
      })
    ).toMatchObject({ ok: true })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_check_id: CHECK,
      p_at: "2026-11-10T10:00:00Z",
    })
    expect(
      await knowledge.getSlotHistory(actor, { checkId: CHECK, at: "soon" })
    ).toMatchObject({
      code: "invalid_input",
    })
    expect(
      await knowledge.listSlotEvents(actor, {
        checkId: CHECK,
        cursor: "2026-11-10T10:00:00.000000Z|42",
        limit: 10,
      })
    ).toEqual({ ok: true, items: [], nextCursor: null })
    for (const bad of [
      { checkId: CHECK, cursor: "x" },
      { checkId: CHECK, limit: 51 },
    ])
      expect(await knowledge.listSlotEvents(actor, bad)).toMatchObject({
        code: "invalid_input",
      })
  })

  it("run an upgrade only with a key and a mode", async () => {
    const { actor } = actorWith({
      knowledge_upgrade_run: () => ({ data: { runId: KEY, mode: "dry_run" } }),
    })
    expect(
      await knowledge.runSchemaUpgrade(actor, {
        key: "guest_toilets",
        mode: "dry_run",
      })
    ).toMatchObject({ ok: true })
    expect(
      await knowledge.runSchemaUpgrade(actor, {
        key: "guest_toilets",
        mode: "now",
      })
    ).toMatchObject({ code: "invalid_input" })
  })
})

describe("correction errors", () => {
  it("map to non-retryable 4xx codes", () => {
    expect(
      knowledgeRpcFailure({ code: "22023", message: "nothing_to_correct" }, "t")
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { headline: expect.any(String) },
    })
    expect(
      knowledgeRpcFailure({ code: "42501", message: "not_venue_manager" }, "t")
    ).toMatchObject({ status: 403 })
    expect(
      knowledgeRpcFailure({ code: "NLK03", message: "already_decided" }, "t")
    ).toMatchObject({ code: "already_decided", status: 409 })
  })
})
