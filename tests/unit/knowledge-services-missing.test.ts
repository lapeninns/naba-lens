// The services seam before the B01 migrations (L-c): a missing function
// (PGRST202 / 42883) reads as on main, not as a read that failed. To confirm
// is an empty list and a question is not in scope; any other failure stays a
// failure.
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const server = vi.hoisted(() => ({
  confirmFinding: vi.fn(),
  reaffirmAnswer: vi.fn(),
  requestMoreDetail: vi.fn(),
  declineFinding: vi.fn(),
  markUnknownSeen: vi.fn(),
  knowledgeRpcFailure: vi.fn(),
}))
vi.mock("@/lib/server/knowledge", () => server)
const rpc = vi.hoisted(() => ({ knowledgeRpc: vi.fn() }))
vi.mock("@/lib/server/knowledge/rpc", () => rpc)

import { adaptCheck, adaptSubmitted } from "@/lib/knowledge-client/adapt"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import type {
  KnowledgeCheckView,
  SubmitKnowledgeResult,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

const CHECK = "8a000000-0000-4000-8000-000000000201"
const VENUE = "9b000000-0000-4000-8000-000000000201"
const db = {} as MediaActor["db"]
const actor = { db } as MediaActor
const DOWN = { ok: false, code: "unavailable", status: 503, message: "down" }

const check = (over: Partial<KnowledgeCheckView> = {}): KnowledgeCheckView => ({
  checkId: CHECK,
  venueId: VENUE,
  questionKey: "onsite_parking",
  question: "Is there parking on site?",
  category: "Arrival",
  evidenceRule: "photo",
  captureBrief: null,
  inScope: true,
  slotRevision: 9,
  status: "available",
  reason: null,
  detail: null,
  progress: "complete",
  checkStatus: "active",
  answerInUse: {
    value: "yes",
    available: true,
    reason: null,
    savedAt: "2026-11-03T14:05:00.000Z",
    sentAt: "2026-11-03T14:00:00.000Z",
    lastCheckedAt: null,
    confirmed: false,
    confirmationState: "not_required",
    evidenceState: "complete",
  },
  previousAnswer: null,
  requiresConfirmation: false,
  latestAttempt: null,
  assignee: null,
  mode: "change",
  othersPending: 0,
  myLatest: null,
  myDraft: null,
  closedAssignment: null,
  permissions: {
    canContribute: false,
    canReportChange: false,
    canConfirm: true,
    canSelfConfirm: false,
    canRequestDetail: true,
    canDecline: true,
  },
  pending: [],
  ...over,
})

const missing = (code: string) => ({
  data: null,
  error: { code, message: "function not found" },
})

beforeEach(() => {
  vi.clearAllMocks()
  server.knowledgeRpcFailure.mockReturnValue(DOWN)
})

describe("knowledge services seam: To confirm before the migrations (L-c)", () => {
  it.each(["PGRST202", "42883"])(
    "reads a missing function (%s) as nothing to confirm",
    async (code) => {
      rpc.knowledgeRpc.mockResolvedValue(missing(code))
      expect(await knowledgeServices.listToConfirm(actor, {})).toEqual({
        ok: true,
        view: { count: 0, items: [] },
      })
      expect(rpc.knowledgeRpc).toHaveBeenCalledWith(
        db,
        "knowledge_to_confirm",
        {
          p_venue_id: null,
        }
      )
      expect(server.knowledgeRpcFailure).not.toHaveBeenCalled()
    }
  )

  it("keeps any other failure a failure", async () => {
    const error = { code: "57014", message: "canceling statement" }
    rpc.knowledgeRpc.mockResolvedValue({ data: null, error })
    expect(await knowledgeServices.listToConfirm(actor, {})).toBe(DOWN)
    expect(server.knowledgeRpcFailure).toHaveBeenCalledWith(
      error,
      "knowledge to confirm"
    )
  })

  it("passes the venue on and refuses one that isn't an id, without a read", async () => {
    rpc.knowledgeRpc.mockResolvedValue({
      data: { count: 0, items: [] },
      error: null,
    })
    await knowledgeServices.listToConfirm(actor, { venueId: VENUE })
    expect(rpc.knowledgeRpc).toHaveBeenCalledWith(db, "knowledge_to_confirm", {
      p_venue_id: VENUE,
    })
    rpc.knowledgeRpc.mockClear()
    expect(
      await knowledgeServices.listToConfirm(actor, { venueId: "nope" })
    ).toMatchObject({ ok: false, code: "invalid_input" })
    expect(rpc.knowledgeRpc).not.toHaveBeenCalled()
  })
})

describe("knowledge services seam: a question before the migrations (L-c)", () => {
  const input = { checkId: CHECK, venueName: "The Old Crown" }

  it.each(["PGRST202", "42883"])(
    "reads a missing function (%s) as not in scope",
    async (code) => {
      rpc.knowledgeRpc.mockResolvedValue(missing(code))
      expect(await knowledgeServices.getKnowledgeCheck(actor, input)).toEqual({
        ok: true,
        view: { inScope: false },
      })
      expect(server.knowledgeRpcFailure).not.toHaveBeenCalled()
    }
  )

  it("keeps any other failure a failure", async () => {
    const error = { code: "57014", message: "canceling statement" }
    rpc.knowledgeRpc.mockResolvedValue({ data: null, error })
    expect(await knowledgeServices.getKnowledgeCheck(actor, input)).toBe(DOWN)
    expect(server.knowledgeRpcFailure).toHaveBeenCalledWith(
      error,
      "knowledge check"
    )
  })

  it("an id that isn't one is not found, without a read", async () => {
    expect(
      await knowledgeServices.getKnowledgeCheck(actor, {
        checkId: "nope",
        venueName: "The Old Crown",
      })
    ).toMatchObject({ ok: false })
    expect(rpc.knowledgeRpc).not.toHaveBeenCalled()
  })

  it("a decider's question reads To confirm for its venue; a missing To confirm adds nothing", async () => {
    rpc.knowledgeRpc
      .mockResolvedValueOnce({ data: check(), error: null })
      .mockResolvedValueOnce(missing("PGRST202"))
    const result = await knowledgeServices.getKnowledgeCheck(actor, input)
    expect(rpc.knowledgeRpc).toHaveBeenNthCalledWith(1, db, "knowledge_check", {
      p_check_id: CHECK,
    })
    expect(rpc.knowledgeRpc).toHaveBeenNthCalledWith(
      2,
      db,
      "knowledge_to_confirm",
      { p_venue_id: VENUE }
    )
    expect(result).toMatchObject({
      ok: true,
      view: { inScope: true, pending: [] },
    })
  })

  it("doesn't read To confirm for someone who can't decide", async () => {
    rpc.knowledgeRpc.mockResolvedValueOnce({
      data: check({
        permissions: { ...check().permissions, canConfirm: false },
      }),
      error: null,
    })
    await knowledgeServices.getKnowledgeCheck(actor, input)
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(1)
  })
})

describe("adapters for the draft-save guard (R11)", () => {
  it("passes mySentAt onto the capture screen's slot, and leaves it out from an older server", () => {
    const sent = adaptCheck(
      check({ mySentAt: "2026-11-05T10:00:00.000Z" }),
      "The Old Crown"
    )
    if (!sent.inScope) throw new Error("in scope")
    expect(sent.slot.mySentAt).toBe("2026-11-05T10:00:00.000Z")
    const never = adaptCheck(check({ mySentAt: null }), "The Old Crown")
    if (!never.inScope) throw new Error("in scope")
    expect(never.slot.mySentAt).toBeNull()
    const old = adaptCheck(check(), "The Old Crown")
    if (!old.inScope) throw new Error("in scope")
    expect("mySentAt" in old.slot).toBe(false)
  })

  it("passes a send's sentAt on, and leaves it out when absent", () => {
    const base: SubmitKnowledgeResult = {
      findingRef: { type: "contribution", id: "f1" },
      submissionId: null,
      outcome: "current",
      replacedOwn: null,
      replacedOwnSentAt: null,
      slotRevision: 8,
      replayed: false,
      recognition: { kind: "none" },
    }
    expect(
      adaptSubmitted({ ...base, sentAt: "2026-11-08T09:00:00.000Z" }).sentAt
    ).toBe("2026-11-08T09:00:00.000Z")
    expect("sentAt" in adaptSubmitted(base)).toBe(false)
  })
})
