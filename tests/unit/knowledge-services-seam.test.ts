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
}))
vi.mock("@/lib/server/knowledge", () => server)

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
    const view = {
      checkId: "c1",
      venueId: "v1",
      inScope: true,
      status: "available",
      reason: null,
      detail: null,
      answerInUse: null,
      pending: [],
      permissions: { canConfirm: false },
    }
    server.getKnowledgeCheck.mockResolvedValue({ ok: true, check: view })
    await knowledgeServices.getKnowledgeCheck(actor, {
      checkId: "c1",
      venueName: "The Old Crown",
    })
    expect(server.getKnowledgeCheck).toHaveBeenCalledWith(actor, {
      checkId: "c1",
    })
    expect(server.listToConfirm).not.toHaveBeenCalled()

    server.getKnowledgeCheck.mockResolvedValue({
      ok: true,
      check: { ...view, permissions: { canConfirm: true } },
    })
    server.listToConfirm.mockResolvedValue({ ok: true, count: 0, items: [] })
    await knowledgeServices.getKnowledgeCheck(actor, {
      checkId: "c1",
      venueName: "The Old Crown",
    })
    expect(server.listToConfirm).toHaveBeenCalledWith(actor, { venueId: "v1" })
  })
})
