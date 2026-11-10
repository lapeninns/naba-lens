// @vitest-environment jsdom
// B03-A (UI §2.3 S1, §3.5): a confirmed step-free entrance Yes names the
// entrances saved as Step-free and the day it was checked, apart from when it
// was recorded, on staff Home, the capture context and the manager's Where it
// stands. Unnamed entrances never read as a Yes for the whole venue; other
// headlines, questions and old answers keep their words; no person is named.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import {
  answerInUseLines,
  captureContextLines,
  slotRow,
} from "@/components/nabalens/knowledge/copy"
import { WorkingListSection } from "@/components/nabalens/knowledge/working-list"
import type {
  AnswerInUse,
  FindingSummary,
  QuestionView,
  WorkingSlot,
} from "@/lib/knowledge-client/contract"

afterEach(cleanup)

const STEP_FREE_YES: AnswerInUse = {
  status: "available",
  reason: null,
  detail: null,
  value: "yes",
  savedAt: "2026-11-04T09:00:00.000Z",
  sentAt: "2026-11-04T08:55:00.000Z",
  answerDetail: { entrances: [{ subjectId: "e1", stepFree: "yes" }] },
  observedOn: "2026-11-03",
  stepFreeEntranceIds: ["e1"],
  entranceLabels: ["Main entrance"],
  confirmation: {
    state: "confirmed",
    self: false,
    at: "2026-11-04T10:00:00.000Z",
    by: null,
  },
}

const MINE: FindingSummary = {
  findingRef: { type: "contribution", id: "f1" },
  checkId: "c1",
  question: "Is there a step-free entrance?",
  venue: { id: "v1", name: "The Old Crown" },
  answer: "yes",
  kind: "finding",
  state: "current",
  noLongerUsed: null,
  stateReason: null,
  managerNote: null,
  detailRequestId: null,
  unknownPreset: null,
  answeredBy: null,
  sentAt: "2026-11-04T08:55:00.000Z",
  savedAt: null,
  decidedAt: "2026-11-04T10:00:00.000Z",
  recognition: { kind: "none" },
}

function slot(over: Partial<WorkingSlot> = {}): WorkingSlot {
  return {
    checkId: "c1",
    key: "step_free_entrance",
    question: "Is there a step-free entrance?",
    category: "Access",
    evidenceRule: "photo",
    progress: "complete",
    slotRevision: 3,
    answerInUse: STEP_FREE_YES,
    previousAnswer: null,
    latestAttempt: null,
    assignee: { firstName: "Sam", isMe: false },
    mode: "change",
    requiresConfirmation: true,
    myLatest: null,
    myDraft: null,
    othersPending: 0,
    closedAssignment: null,
    ...over,
  }
}

const list = (...slots: WorkingSlot[]) => ({
  venue: { id: "v1", name: "The Old Crown" },
  slots,
})

describe("staff Home rows", () => {
  it("says where, and that I checked it on the day, when it is my finding", () => {
    render(<WorkingListSection list={list(slot({ myLatest: MINE }))} />)
    expect(
      screen.getByText(
        "Current answer: Yes, at Main entrance. You checked on 3 Nov 2026."
      )
    ).toBeTruthy()
    expect(
      screen.getByRole("link", {
        name: "Report a change: Is there a step-free entrance? (Yes, at Main entrance)",
      })
    ).toBeTruthy()
  })

  it("names no one when someone else checked it", () => {
    render(<WorkingListSection list={list(slot())} />)
    const row = screen.getByRole("listitem")
    expect(row.textContent).toContain(
      "Current answer: Yes, at Main entrance. Checked on 3 Nov 2026."
    )
    expect(row.textContent).not.toMatch(/You checked|Recorded|Sam|e1/)
  })

  it("never reads as a Yes for the venue when the entrance can't be named", () => {
    const unnamed = { ...STEP_FREE_YES, entranceLabels: undefined }
    const row = slotRow(slot({ answerInUse: unnamed }))
    expect(row.status).toBe(
      "Current answer: Yes, at an entrance this screen can't name. Checked on 3 Nov 2026."
    )
    const none = { ...unnamed, stepFreeEntranceIds: [] }
    expect(slotRow(slot({ answerInUse: none })).status).toMatch(
      /^Current answer: Yes, at an entrance this screen can't name\./
    )
  })

  it("says Recorded when the day it was checked isn't known", () => {
    const undated = { ...STEP_FREE_YES, observedOn: undefined }
    expect(slotRow(slot({ answerInUse: undated })).status).toBe(
      "Current answer: Yes, at Main entrance. Recorded 4 Nov 2026."
    )
  })

  it("keeps an old answer's words, and other questions and headlines as they were", () => {
    const old: AnswerInUse = {
      ...STEP_FREE_YES,
      answerDetail: undefined,
      observedOn: undefined,
      stepFreeEntranceIds: undefined,
      entranceLabels: undefined,
    }
    expect(slotRow(slot({ answerInUse: old })).status).toBe(
      "Current answer: Yes. Recorded 4 Nov 2026."
    )
    expect(slotRow(slot({ answerInUse: old })).answerName).toBeUndefined()
    const no = { ...old, value: "no" as const }
    expect(slotRow(slot({ answerInUse: no })).status).toBe(
      "Current answer: No. Recorded 4 Nov 2026."
    )
    const pending: AnswerInUse = {
      ...STEP_FREE_YES,
      status: "unavailable",
      reason: "not_confirmed",
      detail: "pending",
    }
    expect(answerInUseLines(pending, slot())).toEqual([
      "Recorded answer: Yes. Awaiting confirmation.",
    ])
  })

  it("doesn't put features or measurements on Home", () => {
    const measured = {
      ...STEP_FREE_YES,
      answerDetail: {
        ...STEP_FREE_YES.answerDetail,
        features: { ramp: "yes" },
        measurements: [{ feature: "ramp", value: 900, unit: "mm" }],
      },
    }
    render(<WorkingListSection list={list(slot({ answerInUse: measured }))} />)
    expect(screen.getByRole("listitem").textContent).not.toMatch(/ramp|900|mm/)
  })
})

describe("the capture context", () => {
  it("names the entrance in the current answer it may change", () => {
    const [, line] = captureContextLines({
      venueName: "The Old Crown",
      slot: slot(),
      role: "staff",
    })
    expect(line).toMatch(
      /^Current answer: Yes, at Main entrance, recorded 4 Nov 2026\. If you send/
    )
  })
})

describe("the manager's Where it stands", () => {
  function view(answer: AnswerInUse): Extract<QuestionView, { inScope: true }> {
    const s = slot({ answerInUse: answer, mode: "answer", assignee: null })
    return {
      inScope: true,
      venue: { id: "v1", name: "The Old Crown" },
      capture: {
        id: "c1",
        venueId: "v1",
        status: "active",
        progress: "complete",
        recheckReason: null,
        revision: 3,
        entry: {
          key: s.key,
          category: s.category,
          question: s.question,
          captureBrief: "",
          evidenceRule: "photo",
        },
      },
      slot: s,
      pending: [],
      permissions: {
        canContribute: true,
        canReportChange: false,
        canConfirm: true,
        canSelfConfirm: false,
        canRequestDetail: true,
        canDecline: true,
      },
      history: [],
    }
  }

  async function renderCheck(answer: AnswerInUse) {
    const { AmenityCheckDetail } =
      await import("@/components/nabalens/amenities/manage")
    const { detail, STEP_FREE_CHECK } =
      await import("./amenities-manage-fixtures")
    render(
      <AmenityCheckDetail
        detail={detail({
          check: { ...STEP_FREE_CHECK, progress: "complete", answer: "yes" },
        })}
        basePath="/manager"
        handlers={{
          assign: vi.fn(),
          setNotes: vi.fn(),
          archive: vi.fn(),
          restore: vi.fn(),
          reopen: vi.fn(),
        }}
        knowledge={{
          view: view(answer),
          handlers: { decide: vi.fn(), onResolveConflict: vi.fn() },
        }}
      />
    )
    const section = screen
      .getByRole("heading", { name: "Where it stands" })
      .closest("section")!
    const row = (term: string) =>
      within(section).getByText(term, { selector: "dt" }).nextElementSibling
        ?.textContent
    return { section, row }
  }

  it("shows where, Checked on and Recorded apart, then what it covers", async () => {
    const { section, row } = await renderCheck(STEP_FREE_YES)
    expect(row("Answer")).toMatch(/^Current answer: Yes, at Main entrance\./)
    expect(row("Checked on")).toBe("3 Nov 2026")
    expect(row("Recorded")).toBe("4 Nov 2026")
    expect(
      within(section).getByText(
        "This covers Main entrance only. It says nothing about other entrances, routes inside, toilets or seating."
      )
    ).toBeTruthy()
  })

  it("names no place and says nothing it covers when the entrance can't be named", async () => {
    const { section, row } = await renderCheck({
      ...STEP_FREE_YES,
      entranceLabels: undefined,
    })
    expect(row("Answer")).toMatch(
      /^Current answer: Yes, at an entrance this screen can't name\./
    )
    expect(within(section).queryByText(/^This covers/)).toBeNull()
  })

  it("keeps an old answer's line and adds no date rows", async () => {
    const { section, row } = await renderCheck({
      ...STEP_FREE_YES,
      answerDetail: undefined,
      observedOn: undefined,
      stepFreeEntranceIds: undefined,
      entranceLabels: undefined,
    })
    expect(row("Answer")).toMatch(
      /^Current answer: Yes\. Recorded 4 Nov 2026\./
    )
    expect(
      within(section).queryByText("Checked on", { selector: "dt" })
    ).toBeNull()
  })
})
