// B03-A (UI §3.5): a step-free entrance Yes keeps its saved entrances and the
// day it was checked through the adapter, and the working list names them
// from one same-venue Places read. Any gap names no place.
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

import {
  adaptAnswerInUse,
  needsEntranceLabels,
  withEntranceLabels,
} from "@/lib/knowledge-client/adapt"
import { withWorkingListEntrances } from "@/lib/knowledge-client/entrances"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import type { KnowledgeSlotView, SubjectView } from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

const VENUE = "9b000000-0000-4000-8000-000000000301"
const MAIN = "5a000000-0000-4000-8000-000000000001"
const SIDE = "5a000000-0000-4000-8000-000000000002"
const actor = { db: {} } as MediaActor

type InUse = NonNullable<KnowledgeSlotView["answerInUse"]>

function slot(
  over: Partial<KnowledgeSlotView> = {},
  answer: Partial<InUse> = {}
): KnowledgeSlotView {
  return {
    checkId: "8a000000-0000-4000-8000-000000000301",
    venueId: VENUE,
    questionKey: "step_free_entrance",
    question: "Is there a step-free entrance?",
    category: "Access",
    evidenceRule: "photo",
    captureBrief: null,
    inScope: true,
    slotRevision: 3,
    status: "available",
    reason: null,
    detail: null,
    progress: "complete",
    checkStatus: "active",
    answerInUse: {
      value: "yes",
      available: true,
      reason: null,
      savedAt: "2026-11-04T09:00:00.000Z",
      sentAt: "2026-11-04T08:55:00.000Z",
      lastCheckedAt: null,
      confirmed: true,
      confirmationState: "confirmed",
      evidenceState: "complete",
      detail: {
        entrances: [
          { subjectId: MAIN, stepFree: "yes" },
          { subjectId: SIDE, stepFree: "no" },
        ],
      },
      detailRecorded: true,
      observedOn: "2026-11-03",
      ...answer,
    },
    previousAnswer: null,
    requiresConfirmation: true,
    latestAttempt: null,
    assignee: null,
    mode: "change",
    othersPending: 0,
    myLatest: null,
    myDraft: null,
    closedAssignment: null,
    ...over,
  }
}

const place = (over: Partial<SubjectView>): SubjectView => ({
  subjectId: MAIN,
  kind: "entrance",
  label: "Main entrance",
  active: true,
  ...over,
})

describe("adaptAnswerInUse keeps the step-free detail and Checked on", () => {
  it("keeps the saved Step-free entrances, in order, and the checked date", () => {
    const answer = adaptAnswerInUse(slot())
    expect(answer.stepFreeEntranceIds).toEqual([MAIN])
    expect(answer.observedOn).toBe("2026-11-03")
    expect(answer.entranceLabels).toBeUndefined()
  })

  it("drops a date that isn't a real calendar date", () => {
    for (const observedOn of ["2026-02-30", "3 Nov", "2026-11-03T00:00:00Z"])
      expect(
        adaptAnswerInUse(slot({}, { observedOn })).observedOn
      ).toBeUndefined()
  })

  it("leaves other headlines, other keys and old answers without entrances", () => {
    expect(
      adaptAnswerInUse(slot({}, { value: "no" })).stepFreeEntranceIds
    ).toBeUndefined()
    expect(
      adaptAnswerInUse(slot({ questionKey: "level_access_bar" }))
        .stepFreeEntranceIds
    ).toBeUndefined()
    expect(
      adaptAnswerInUse(slot({}, { detail: null, detailRecorded: false }))
        .stepFreeEntranceIds
    ).toBeUndefined()
  })

  it("reads a Yes whose detail names no Step-free entrance as none, not as every entrance", () => {
    const answer = adaptAnswerInUse(
      slot({}, { detail: { entrances: [{ subjectId: MAIN, stepFree: "no" }] } })
    )
    expect(answer.stepFreeEntranceIds).toEqual([])
    expect(needsEntranceLabels(answer)).toBe(false)
  })
})

describe("withEntranceLabels names entrances only from the same venue's places", () => {
  const answer = adaptAnswerInUse(slot())

  it("sets the labels when every saved entrance is listed", () => {
    expect(
      withEntranceLabels(answer, VENUE, { venueId: VENUE, places: [place({})] })
        .entranceLabels
    ).toEqual(["Main entrance"])
  })

  it("names no place for a missing, other-kind or other-venue entrance, or no read", () => {
    const cases = [
      { venueId: VENUE, places: [place({ subjectId: SIDE })] },
      { venueId: VENUE, places: [place({ kind: "room" })] },
      { venueId: "another-venue", places: [place({})] },
      { venueId: VENUE, places: null },
      null,
    ]
    for (const read of cases)
      expect(
        withEntranceLabels(answer, VENUE, read).entranceLabels
      ).toBeUndefined()
  })
})

describe("Home's working list reads places once, only for a step-free Yes", () => {
  beforeEach(() => rpc.knowledgeRpc.mockReset())

  const list = (items: KnowledgeSlotView[]) => ({
    data: { venue: { id: VENUE, name: "The Old Crown" }, items },
    error: null,
  })

  /** The list as every staff page reads it, then as Home and To do name it. */
  async function read(items: KnowledgeSlotView[]) {
    rpc.knowledgeRpc.mockResolvedValueOnce(list(items))
    const result = await knowledgeServices.getWorkingList(actor, {})
    if (!result.ok || !result.view) throw new Error("no list")
    // The shared read (the shell's, on every staff page) reads no places.
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(1)
    return withWorkingListEntrances(actor, result.view)
  }

  it("names the entrance from one Places read", async () => {
    rpc.knowledgeRpc
      .mockResolvedValueOnce(
        list([slot(), slot({ checkId: "c2" }), slot({ questionKey: "x" })])
      )
      .mockResolvedValueOnce({
        data: { venueId: VENUE, items: [place({})] },
        error: null,
      })
    const result = await knowledgeServices.getWorkingList(actor, {})
    if (!result.ok || !result.view) throw new Error("no list")
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(1)
    const named = await withWorkingListEntrances(actor, result.view)
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(2)
    expect(rpc.knowledgeRpc.mock.calls[1]?.[1]).toBe("knowledge_subjects")
    expect(rpc.knowledgeRpc.mock.calls[1]?.[2]).toEqual({ p_venue_id: VENUE })
    expect(
      named.slots.map((s) => s.answerInUse.entranceLabels ?? null)
    ).toEqual([["Main entrance"], ["Main entrance"], null])
  })

  it("doesn't read places when no step-free Yes is in use", async () => {
    await read([slot({}, { value: "no" }), slot({ questionKey: "x" })])
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(1)
  })

  it("keeps the list and names no place when places can't be read", async () => {
    server.knowledgeRpcFailure.mockReturnValueOnce({
      ok: false,
      code: "not_permitted",
      status: 403,
      message: "no",
    })
    rpc.knowledgeRpc.mockResolvedValueOnce(list([slot()]))
    const result = await knowledgeServices.getWorkingList(actor, {})
    if (!result.ok || !result.view) throw new Error("no list")
    rpc.knowledgeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501" },
    })
    const named = await withWorkingListEntrances(actor, result.view)
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(2)
    expect(named.slots[0]?.answerInUse.entranceLabels).toBeUndefined()
    expect(named.slots[0]?.answerInUse.stepFreeEntranceIds).toEqual([MAIN])
  })
})
