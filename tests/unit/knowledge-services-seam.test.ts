import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const server = vi.hoisted(() => ({
  confirmFinding: vi.fn(),
  reaffirmAnswer: vi.fn(),
  requestMoreDetail: vi.fn(),
  declineFinding: vi.fn(),
  markUnknownSeen: vi.fn(),
  getKnowledgeCheck: vi.fn(),
  listToConfirm: vi.fn(),
  knowledgeRpcFailure: vi.fn(),
  listKnowledgeAssets: vi.fn(),
}))
vi.mock("@/lib/server/knowledge", () => server)
const rpc = vi.hoisted(() => ({ knowledgeRpc: vi.fn() }))
vi.mock("@/lib/server/knowledge/rpc", () => rpc)

import { knowledgeServices } from "@/lib/knowledge-client/services"
import type { MediaActor } from "@/lib/server/media/types"

const actor = {} as MediaActor
const decided = {
  ok: true,
  decisionId: "d1",
  submissionId: null,
  replacedAnswer: null,
  slotRevision: 4,
  replayed: false,
}

beforeEach(() => vi.clearAllMocks())

describe("knowledge services seam", () => {
  it.each([
    ["confirm", "confirmFinding"],
    ["reaffirm", "reaffirmAnswer"],
    ["request_detail", "requestMoreDetail"],
    ["decline", "declineFinding"],
    ["seen", "markUnknownSeen"],
  ] as const)(
    "sends %s to the server's %s with the finding ref",
    async (decision, fn) => {
      server[fn].mockResolvedValue(decided)
      const input = {
        findingRef: { type: "contribution", id: "f1" },
        decision,
        slotRevision: 3,
        idempotencyKey: "k",
      }
      expect(await knowledgeServices.decide(actor, input)).toEqual({
        ok: true,
        slotRevision: 4,
        replayed: false,
        replacedAnswer: null,
      })
      expect(server[fn]).toHaveBeenCalledWith(actor, input)
    }
  )

  it("refuses an unknown decision without calling the server", async () => {
    const result = await knowledgeServices.decide(actor, { decision: "revoke" })
    expect(result).toMatchObject({ ok: false, code: "invalid_input" })
    for (const fn of Object.values(server)) expect(fn).not.toHaveBeenCalled()
  })

  it("reads To confirm for the check page only when the caller decides", async () => {
    const CHECK = "8a000000-0000-4000-8000-000000000001"
    const VENUE = "9b000000-0000-4000-8000-000000000001"
    const view = {
      checkId: CHECK,
      venueId: VENUE,
      inScope: false,
      permissions: { canConfirm: false },
    }
    const db = {} as MediaActor["db"]
    const withDb = { db } as MediaActor
    rpc.knowledgeRpc.mockResolvedValue({ data: view, error: null })
    await knowledgeServices.getKnowledgeCheck(withDb, {
      checkId: CHECK,
      venueName: "The Old Crown",
    })
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(1)
    expect(rpc.knowledgeRpc).toHaveBeenCalledWith(db, "knowledge_check", {
      p_check_id: CHECK,
    })
    // A decider on an in-scope question: tests/unit/knowledge-services-missing.test.ts.
  })
})

describe("knowledge services seam: the working list before the migrations (M3)", () => {
  const list = {
    venue: { id: "v1", name: "The Old Crown" },
    items: [],
  }
  const db = {} as MediaActor["db"]
  const withDb = { db } as MediaActor

  it.each(["PGRST202", "42883"])(
    "reads a missing function (%s) as no working list, as on main",
    async (code) => {
      rpc.knowledgeRpc.mockResolvedValue({
        data: null,
        error: { code, message: "function not found" },
      })
      expect(await knowledgeServices.getWorkingList(withDb, {})).toEqual({
        ok: true,
        view: null,
      })
      expect(server.knowledgeRpcFailure).not.toHaveBeenCalled()
    }
  )

  it("keeps any other failure a failure", async () => {
    const error = { code: "57014", message: "canceling statement" }
    rpc.knowledgeRpc.mockResolvedValue({ data: null, error })
    server.knowledgeRpcFailure.mockReturnValue({
      ok: false,
      code: "unavailable",
      status: 503,
      message: "down",
    })
    expect(await knowledgeServices.getWorkingList(withDb, {})).toMatchObject({
      ok: false,
      code: "unavailable",
    })
    expect(server.knowledgeRpcFailure).toHaveBeenCalledWith(
      error,
      "knowledge working list"
    )
  })

  it("adapts the list when the read works", async () => {
    rpc.knowledgeRpc.mockResolvedValue({ data: list, error: null })
    expect(await knowledgeServices.getWorkingList(withDb, {})).toEqual({
      ok: true,
      view: { venue: list.venue, slots: [] },
    })
    expect(rpc.knowledgeRpc).toHaveBeenCalledWith(
      db,
      "knowledge_working_list",
      {}
    )
  })
})

describe("knowledge services seam: own media for a working-list question (F1)", () => {
  it("passes the input to WS1's listKnowledgeAssets", async () => {
    const result = { ok: true, assets: [] }
    server.listKnowledgeAssets.mockResolvedValue(result)
    expect(
      await knowledgeServices.listKnowledgeAssets(actor, { checkId: "c1" })
    ).toBe(result)
    expect(server.listKnowledgeAssets).toHaveBeenCalledWith(actor, {
      checkId: "c1",
    })
  })
})
