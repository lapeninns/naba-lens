// B02-a services (docs/knowledge/b02-design.md R1, R3, R5, R8, R9, R10, R11)
// with a mocked caller-scoped RPC client: request shapes, error mapping and
// the old signatures staying in use when a client sends no new field.
import { afterEach, describe, expect, it, vi } from "vitest"

import { KNOWLEDGE_SQLSTATES } from "@/lib/knowledge/contract"
import * as amenities from "@/lib/server/amenities"
import * as knowledge from "@/lib/server/knowledge"
import { knowledgeRpcFailure } from "@/lib/server/knowledge/errors"
import { parseFeedCursor } from "@/lib/server/knowledge/validate"
import type { MediaActor } from "@/lib/server/media/types"

const VENUE = "11111111-1111-4111-8111-111111111111"
const CHECK = "33333333-3333-4333-8333-333333333333"
const USER = "44444444-4444-4444-8444-444444444444"
const ASSET = "55555555-5555-4555-8555-555555555555"
const KEY = "77777777-7777-4777-8777-777777777777"
const SENT = "2026-11-10T09:15:00.123456+00:00"

type Handler = (args: Record<string, unknown>) => {
  data?: unknown
  error?: { message?: string; code?: string; details?: string | null }
}

/** A manager holding a grant at VENUE, as the amenity context reads it. */
function actorWith(handlers: Record<string, Handler>) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    if (fn === "coverage_access_scope")
      return {
        data: [
          {
            user_id: USER,
            active: true,
            is_admin: false,
            role: "manager",
            venue_id: VENUE,
            venue_active: true,
            department: "foh",
            manager_venue_id: VENUE,
          },
        ],
        error: null,
      }
    const handler = handlers[fn]
    if (!handler) throw new Error(`unexpected rpc ${fn}`)
    const out = handler(args)
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  const actor = {
    profile: { id: USER, active: true, role: "manager" },
    db,
    service: db,
    storage: {},
  } as unknown as MediaActor
  return { actor, rpc }
}

const calls = (rpc: ReturnType<typeof actorWith>["rpc"], fn: string) =>
  rpc.mock.calls.filter(([name]) => name === fn).map(([, args]) => args)

afterEach(() => vi.restoreAllMocks())

describe("draft_already_sent (R11)", () => {
  it("is NLK09 in the contract and maps to a non-retryable 409 with its send", () => {
    expect(KNOWLEDGE_SQLSTATES.NLK09).toBe("draft_already_sent")
    for (const [code, message] of [
      ["NLK09", "something new"],
      ["P0001", "draft_already_sent"],
      ["NLK09", "draft_already_sent"],
    ]) {
      expect(
        knowledgeRpcFailure(
          {
            code,
            message,
            details: JSON.stringify({ reason: "newer_send", sentAt: SENT }),
          },
          "t"
        )
      ).toMatchObject({
        ok: false,
        code: "draft_already_sent",
        status: 409,
        sentReason: "newer_send",
        sentAt: SENT,
      })
    }
    expect(
      knowledgeRpcFailure(
        {
          code: "NLK09",
          message: "draft_already_sent",
          details: JSON.stringify({ reason: "key_sent", sentAt: SENT }),
        },
        "t"
      )
    ).toMatchObject({
      sentReason: "key_sent",
      message: "This finding was already sent.",
    })
    // Unreadable detail still refuses, without inventing a reason.
    const bare = knowledgeRpcFailure(
      { code: "NLK09", message: "draft_already_sent", details: "nope" },
      "t"
    )
    expect(bare).toMatchObject({ code: "draft_already_sent", sentAt: null })
    expect(bare).not.toHaveProperty("sentReason")
  })

  it("sends p_base_sent_at only when the form sent a base", async () => {
    const { actor, rpc } = actorWith({
      knowledge_save_draft: () => ({
        data: { draftRevision: 1, savedAt: SENT },
      }),
    })
    const base = {
      checkId: CHECK,
      draftRevision: null,
      payload: { answer: "no" },
      idempotencyKey: KEY,
    }
    await knowledge.saveDraft(actor, base)
    await knowledge.saveDraft(actor, { ...base, baseSentAt: null })
    await knowledge.saveDraft(actor, { ...base, baseSentAt: SENT })
    const sent = calls(rpc, "knowledge_save_draft")
    expect(sent[0]).not.toHaveProperty("p_base_sent_at")
    expect(sent[1]).toMatchObject({ p_base_sent_at: null })
    expect(sent[2]).toMatchObject({ p_base_sent_at: SENT })
    for (const bad of ["yesterday", 42, {}])
      expect(
        await knowledge.saveDraft(actor, { ...base, baseSentAt: bad })
      ).toMatchObject({
        code: "invalid_input",
        fieldErrors: { baseSentAt: expect.any(String) },
      })
    expect(calls(rpc, "knowledge_save_draft")).toHaveLength(3)
  })

  it("returns the refusal from a save, with the send time as the next base", async () => {
    const { actor } = actorWith({
      knowledge_save_draft: () => ({
        error: {
          code: "NLK09",
          message: "draft_already_sent",
          details: JSON.stringify({ reason: "newer_send", sentAt: SENT }),
        },
      }),
    })
    expect(
      await knowledge.saveDraft(actor, {
        checkId: CHECK,
        draftRevision: 2,
        payload: {},
        idempotencyKey: KEY,
        baseSentAt: null,
      })
    ).toMatchObject({
      ok: false,
      code: "draft_already_sent",
      sentReason: "newer_send",
      sentAt: SENT,
    })
  })
})

describe("B02 read refusals", () => {
  it("map to 4xx codes, never unavailable", () => {
    const cases: [string, string, string, number][] = [
      ["42501", "wrong_venue", "wrong_venue", 403],
      ["42501", "not_venue_manager", "not_permitted", 403],
      ["22023", "venue_required", "invalid_input", 400],
      ["P0002", "venue_not_found", "not_found", 404],
      ["P0002", "media_asset_not_found", "not_found", 404],
      ["22023", "invalid_cursor", "invalid_input", 400],
      ["P0001", "not_active_user", "account_inactive", 403],
      ["22023", "invalid_idempotency_key", "invalid_input", 400],
      ["P0001", "idempotency_key_reused", "state_conflict", 409],
    ]
    for (const [code, message, mapped, status] of cases)
      expect(
        knowledgeRpcFailure({ code, message }, "t"),
        message
      ).toMatchObject({
        code: mapped,
        status,
      })
    expect(
      knowledgeRpcFailure({ code: "22023", message: "venue_required" }, "t")
    ).toMatchObject({ fieldErrors: { venueId: expect.any(String) } })
  })
})

describe("B02 reads", () => {
  it("R1: returns the two counts, zeros when the row is missing", async () => {
    const { actor } = actorWith({
      my_label_work: () => ({
        data: [{ needs_labels: 3, needs_attention: 1 }],
      }),
    })
    expect(await knowledge.getLabelWork(actor)).toEqual({
      ok: true,
      work: { needsLabels: 3, needsAttention: 1 },
    })
    const empty = actorWith({ my_label_work: () => ({ data: [] }) })
    expect(await knowledge.getLabelWork(empty.actor)).toEqual({
      ok: true,
      work: { needsLabels: 0, needsAttention: 0 },
    })
  })

  it("R3: one entry per queue in a fixed order, never summed", async () => {
    const { actor, rpc } = actorWith({
      manager_triage_summary: () => ({
        data: [
          {
            queue: "checklist",
            available: false,
            waiting: null,
            oldest_waiting_at: null,
            own_waiting: null,
          },
          {
            queue: "menu_photos",
            available: true,
            waiting: 4,
            oldest_waiting_at: SENT,
            own_waiting: 1,
          },
          {
            queue: "findings",
            available: true,
            waiting: 2,
            oldest_waiting_at: SENT,
            own_waiting: null,
          },
        ],
      }),
    })
    const out = await knowledge.getManagerTriage(actor, {})
    expect(out).toEqual({
      ok: true,
      queues: [
        {
          queue: "menu_photos",
          available: true,
          waiting: 4,
          oldestWaitingAt: SENT,
          ownWaiting: 1,
        },
        {
          queue: "findings",
          available: true,
          waiting: 2,
          oldestWaitingAt: SENT,
          ownWaiting: null,
        },
        {
          queue: "checklist",
          available: false,
          waiting: null,
          oldestWaitingAt: null,
          ownWaiting: null,
        },
      ],
    })
    expect(calls(rpc, "manager_triage_summary")[0]).toEqual({
      p_venue_id: null,
    })
    await knowledge.getManagerTriage(actor, { venueId: VENUE })
    expect(calls(rpc, "manager_triage_summary")[1]).toEqual({
      p_venue_id: VENUE,
    })
    expect(
      await knowledge.getManagerTriage(actor, { venueId: "nope" })
    ).toMatchObject({ code: "invalid_input" })
  })

  it("R5: pages with the feed cursor and a fixed page size", async () => {
    const { actor, rpc } = actorWith({
      my_contributions_feed: () => ({ data: { items: [], nextCursor: null } }),
    })
    const cursor = `2026-11-10T09:15:00.123456Z|p:${ASSET}`
    expect(await knowledge.listMyContributions(actor, { cursor })).toEqual({
      ok: true,
      page: { items: [], nextCursor: null },
    })
    expect(calls(rpc, "my_contributions_feed")[0]).toEqual({
      p_cursor: cursor,
      p_limit: 20,
    })
    expect(
      await knowledge.listMyContributions(actor, { cursor: "x" })
    ).toMatchObject({ code: "invalid_input" })
  })

  it("R8 and R9: pass the venue or asset through", async () => {
    const caps = { accountKind: "manager", venueId: VENUE }
    const impact = { assetId: ASSET, impacts: [] }
    const { actor, rpc } = actorWith({
      my_venue_capabilities: () => ({ data: caps }),
      my_asset_delete_impact: () => ({ data: impact }),
    })
    expect(await knowledge.getVenueCapabilities(actor, {})).toEqual({
      ok: true,
      capabilities: caps,
    })
    expect(calls(rpc, "my_venue_capabilities")[0]).toEqual({ p_venue_id: null })
    expect(
      await knowledge.getAssetDeleteImpact(actor, { assetId: ASSET })
    ).toEqual({ ok: true, impact })
    expect(calls(rpc, "my_asset_delete_impact")[0]).toEqual({
      p_asset_id: ASSET,
    })
    expect(
      await knowledge.getAssetDeleteImpact(actor, { assetId: "nope" })
    ).toMatchObject({ code: "not_found", status: 404 })
    expect(calls(rpc, "my_asset_delete_impact")).toHaveLength(1)
  })
})

describe("parseFeedCursor", () => {
  it("accepts every feed key prefix and nothing else", () => {
    for (const prefix of ["p", "t", "c", "s"])
      expect(
        parseFeedCursor(`2026-11-02T10:00:00.000000Z|${prefix}:${ASSET}`)
      ).toMatchObject({ ok: true })
    expect(
      parseFeedCursor("2026-11-02T10:00:00.000000Z|e:0000000000000000042")
    ).toMatchObject({ ok: true })
    expect(parseFeedCursor(null)).toEqual({ ok: true, value: null })
    for (const bad of [
      `2026-11-02T10:00:00.000000Z|x:${ASSET}`,
      "2026-11-02T10:00:00Z|p:1",
      7,
    ])
      expect(parseFeedCursor(bad), String(bad)).toMatchObject({ ok: false })
  })
})

describe("keyed check writes (R10)", () => {
  const writes = [
    ["assignCheck", "amenity_assign_check", { assigneeId: USER }],
    ["setCheckNotes", "amenity_set_check_notes", { notes: "TEST" }],
    ["reopenCheck", "amenity_reopen_check", { preset: "wrong_area" }],
    ["archiveCheck", "amenity_archive_check", {}],
    ["restoreCheck", "amenity_restore_check", {}],
  ] as const

  it.each(writes)(
    "%s uses the keyed overload only with a key",
    async (service, fn, extra) => {
      const { actor, rpc } = actorWith({
        [fn]: (args) =>
          args.p_idempotency_key
            ? { data: { revision: 5, replayed: true } }
            : { data: 5 },
      })
      const input = { checkId: CHECK, revision: 4, ...extra }
      expect(await amenities[service](actor, input)).toEqual({
        ok: true,
        revision: 5,
      })
      expect(
        await amenities[service](actor, { ...input, idempotencyKey: KEY })
      ).toEqual({ ok: true, revision: 5, replayed: true })
      const sent = calls(rpc, fn)
      expect(sent[0]).not.toHaveProperty("p_idempotency_key")
      expect(sent[1]).toMatchObject({
        p_check_id: CHECK,
        p_revision: 4,
        p_idempotency_key: KEY,
      })
      expect(
        await amenities[service](actor, { ...input, idempotencyKey: "nope" })
      ).toMatchObject({
        code: "invalid_input",
        fieldErrors: { idempotencyKey: expect.any(String) },
      })
      expect(calls(rpc, fn)).toHaveLength(2)
    }
  )

  it("adds checks with a key and returns the same ids on a replay", async () => {
    const { actor, rpc } = actorWith({
      amenity_add_checks: (args) =>
        args.p_idempotency_key
          ? { data: { checkIds: ["c1"], replayed: true } }
          : { data: ["c1"] },
    })
    expect(
      await amenities.addChecks(actor, { keys: ["darts"], idempotencyKey: KEY })
    ).toEqual({ ok: true, checkIds: ["c1"], replayed: true })
    expect(calls(rpc, "amenity_add_checks")[0]).toEqual({
      p_venue_id: VENUE,
      p_keys: ["darts"],
      p_idempotency_key: KEY,
    })
    expect(await amenities.addChecks(actor, { keys: ["darts"] })).toEqual({
      ok: true,
      checkIds: ["c1"],
    })
  })

  it("maps a reused key and a genuine conflict", async () => {
    const { actor } = actorWith({
      amenity_archive_check: (args) => ({
        error:
          args.p_revision === 1
            ? {
                message: "amenity_conflict",
                code: "P0001",
                details: '{"revision": 3}',
              }
            : { message: "idempotency_key_reused", code: "P0001" },
      }),
    })
    expect(
      await amenities.archiveCheck(actor, {
        checkId: CHECK,
        revision: 1,
        idempotencyKey: KEY,
      })
    ).toMatchObject({ code: "revision_conflict", currentRevision: 3 })
    expect(
      await amenities.archiveCheck(actor, {
        checkId: CHECK,
        revision: 2,
        idempotencyKey: KEY,
      })
    ).toMatchObject({ code: "state_conflict", status: 409 })
  })
})
