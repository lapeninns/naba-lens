// B03-e rechecks and freshness (docs/knowledge/b03-design.md §7, A11, A24):
// the recheck services' input checks, the additive triage summary, and the
// error mapping. Mocked RPC client.
import { describe, expect, it, vi } from "vitest"

import * as knowledge from "@/lib/server/knowledge"
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
const TASK = {
  taskId: "11111111-1111-4111-8111-111111111111",
  checkId: CHECK,
  venueId: "33333333-3333-4333-8333-333333333333",
  questionKey: "guest_toilets",
  question: "Are there customer toilets?",
  cause: "expired",
  use: "internal",
  dueAt: "2026-12-01T00:00:00+00:00",
}

describe("recheck reads (A11)", () => {
  it("list the caller's tasks and one check's tasks", async () => {
    const { actor, rpc } = actorWith({
      my_rechecks: () => ({ data: { items: [TASK] } }),
      knowledge_check_rechecks: () => ({ data: { count: 1, items: [] } }),
    })
    expect(await knowledge.listMyRechecks(actor)).toEqual({
      ok: true,
      tasks: [TASK],
    })
    expect(await knowledge.getCheckRechecks(actor, { checkId: CHECK })).toEqual(
      {
        ok: true,
        count: 1,
        tasks: [],
      }
    )
    expect(
      await knowledge.getCheckRechecks(actor, { checkId: "x" })
    ).toMatchObject({
      code: "not_found",
    })
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})

describe("venue rechecks (A41)", () => {
  it("list the venue's open tasks for the caller's venue or a named one", async () => {
    const venueId = TASK.venueId
    const { actor, rpc } = actorWith({
      knowledge_venue_rechecks: () => ({
        data: { venueId, count: 1, items: [TASK] },
      }),
    })
    expect(await knowledge.listVenueRechecks(actor)).toEqual({
      ok: true,
      venueId,
      count: 1,
      tasks: [TASK],
    })
    expect(rpc.mock.calls[0]![1]).toEqual({ p_venue_id: null })
    await knowledge.listVenueRechecks(actor, { venueId })
    expect(rpc.mock.calls[1]![1]).toEqual({ p_venue_id: venueId })
    expect(
      await knowledge.listVenueRechecks(actor, { venueId: "v" })
    ).toMatchObject({ code: "invalid_input" })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("refuse staff as not permitted", async () => {
    const { actor } = actorWith({
      knowledge_venue_rechecks: () => ({
        error: { code: "42501", message: "not_venue_manager" },
      }),
    })
    expect(await knowledge.listVenueRechecks(actor)).toMatchObject({
      ok: false,
      code: "not_permitted",
      status: 403,
    })
  })

  // Review: tasks can exist before the A41 function does, and the function
  // can fail calling a missing one inside it; neither reads as none open.
  it.each(["PGRST202", "42883"])(
    "read a missing function (%s) as unavailable, not an empty queue",
    async (code) => {
      const { actor } = actorWith({
        knowledge_venue_rechecks: () => ({
          error: { code, message: "function not found" },
        }),
      })
      expect(await knowledge.listVenueRechecks(actor)).toMatchObject({
        ok: false,
        code: "unavailable",
      })
    }
  )
})

describe("freshness policies (A42)", () => {
  it("list each policy's latest version, and refuse non-admins", async () => {
    const policy = {
      policyId: "offering_internal",
      version: 2,
      claimClass: "offering",
      use: "internal",
      maxAge: "P90D",
      recheckLead: "P14D",
      basis: "observed_on",
      note: null,
      createdAt: "2026-11-10T10:00:00Z",
    }
    const { actor, rpc } = actorWith({
      knowledge_freshness_policies: () => ({ data: { items: [policy] } }),
    })
    expect(await knowledge.listFreshnessPolicies(actor)).toEqual({
      ok: true,
      policies: [policy],
    })
    expect(rpc.mock.calls[0]).toEqual(["knowledge_freshness_policies", {}])
    const refused = actorWith({
      knowledge_freshness_policies: () => ({
        error: { code: "42501", message: "not_active_admin" },
      }),
    })
    expect(await knowledge.listFreshnessPolicies(refused.actor)).toMatchObject({
      ok: false,
      code: "not_permitted",
    })
  })
})

describe("freshness preview (§7.3)", () => {
  it("sends a key and a policy per use, refusing anything else without a call", async () => {
    const preview = { key: "guest_toilets", items: [] }
    const { actor, rpc } = actorWith({
      knowledge_freshness_preview: () => ({ data: preview }),
    })
    expect(
      await knowledge.previewFreshness(actor, {
        key: "guest_toilets",
        policy: { internal: "offering_internal" },
      })
    ).toEqual({ ok: true, preview })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_key: "guest_toilets",
      p_policy: { internal: "offering_internal", public: null },
    })
    for (const bad of [
      { key: "Guest Toilets", policy: {} },
      { key: "guest_toilets", policy: { internal: "X!" } },
      { key: "guest_toilets", policy: { other: "a" } },
      { key: "guest_toilets" },
    ])
      expect(await knowledge.previewFreshness(actor, bad)).toMatchObject({
        code: "invalid_input",
      })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe("manager triage (§7.4)", () => {
  const row = (queue: string, waiting: number | null) => ({
    queue,
    available: waiting !== null,
    waiting,
    oldest_waiting_at: waiting ? "2026-11-10T10:00:00Z" : null,
    own_waiting: null,
  })

  it("adds the rechecks summary beside the B02 queues when the server sends it", async () => {
    const { actor } = actorWith({
      manager_triage_summary: () => ({
        data: [
          row("menu_photos", 0),
          row("findings", 1),
          row("checklist", null),
          row("rechecks", 2),
        ],
      }),
    })
    const out = await knowledge.getManagerTriage(actor, {})
    expect(out).toMatchObject({
      ok: true,
      rechecks: {
        available: true,
        waiting: 2,
        oldestWaitingAt: "2026-11-10T10:00:00Z",
      },
    })
    expect(
      (out as { queues: { queue: string }[] }).queues.map((q) => q.queue)
    ).toEqual(["menu_photos", "findings", "checklist"])
  })

  it("leaves it out before the B03-e migration", async () => {
    const { actor } = actorWith({
      manager_triage_summary: () => ({ data: [row("menu_photos", 0)] }),
    })
    expect(await knowledge.getManagerTriage(actor, {})).not.toHaveProperty(
      "rechecks"
    )
  })
})
