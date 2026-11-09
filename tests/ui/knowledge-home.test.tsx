// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { sentNoticeFor } from "@/components/nabalens/knowledge/copy"
import { WorkingListSection } from "@/components/nabalens/knowledge/working-list"
import {
  TasksOverview,
  todoCount,
  todoItems,
} from "@/components/nabalens/tasks"
import type { MyAmenityTask } from "@/lib/amenities/contract"
import type {
  AnswerInUse,
  FindingSummary,
  WorkingList,
  WorkingSlot,
} from "@/lib/knowledge-client/contract"

import { PROFILE, tasksView } from "./tasks-fixtures"

afterEach(cleanup)

const NONE: AnswerInUse = {
  status: "unavailable",
  reason: "unknown",
  detail: "not_checked",
  value: null,
  savedAt: null,
  sentAt: null,
  confirmation: { state: "not_required", self: false, at: null, by: null },
}
const YES: AnswerInUse = {
  ...NONE,
  status: "available",
  reason: null,
  detail: null,
  value: "yes",
  savedAt: "2026-11-03T14:05:00.000Z",
}

function finding(over: Partial<FindingSummary> = {}): FindingSummary {
  return {
    findingRef: { type: "contribution", id: "f1" },
    checkId: "c1",
    question: "Is there parking on site?",
    venue: { id: "v1", name: "The Old Crown" },
    answer: "yes",
    kind: "finding",
    state: "awaiting_confirmation",
    noLongerUsed: null,
    stateReason: null,
    managerNote: null,
    detailRequestId: null,
    unknownPreset: null,
    answeredBy: null,
    sentAt: "2026-11-05T10:00:00.000Z",
    savedAt: null,
    decidedAt: null,
    recognition: { kind: "pending" },
    ...over,
  }
}

function slot(over: Partial<WorkingSlot> = {}): WorkingSlot {
  return {
    checkId: "c1",
    key: "onsite_parking",
    question: "Is there parking on site?",
    category: "Arrival",
    evidenceRule: "photo",
    progress: "needs_capture",
    slotRevision: 4,
    answerInUse: NONE,
    previousAnswer: null,
    latestAttempt: null,
    assignee: null,
    mode: "answer",
    requiresConfirmation: false,
    myLatest: null,
    myDraft: null,
    othersPending: 0,
    closedAssignment: null,
    ...over,
  }
}

const ATTENTION = slot({
  checkId: "c-att",
  question: "Is the entrance step-free?",
  category: "Access",
  myLatest: finding({
    checkId: "c-att",
    state: "needs_attention",
    managerNote: "Which door did you check?",
  }),
})
const ASSIGNED = slot({
  checkId: "c-mine",
  question: "Is there a lift?",
  assignee: { firstName: "Sam", isMe: true },
})
const CLOSED = slot({
  checkId: "c-closed",
  question: "Are dogs welcome?",
  answerInUse: YES,
  closedAssignment: {
    eventId: 42,
    answeredBy: "Priya",
    at: "2026-11-04T09:00:00.000Z",
  },
})
const OPEN = slot({ checkId: "c-open", question: "Is there a garden?" })
const ANSWERED = slot({
  checkId: "c-done",
  question: "Is there Wi-Fi?",
  answerInUse: YES,
  mode: "change",
})

const LIST: WorkingList = {
  venue: { id: "v1", name: "The Old Crown" },
  slots: [ANSWERED, OPEN, CLOSED, ASSIGNED, ATTENTION],
}

function task(id: string, question: string): MyAmenityTask {
  return {
    id,
    progress: "needs_capture",
    recheckReason: null,
    entry: {
      position: 1,
      question,
      category: "Arrival",
      evidenceRule: "photo",
    },
  } as unknown as MyAmenityTask
}

describe("Home: working list (B01-06, §4.1)", () => {
  it("lists every question, what needs me first, and counts only those in its badge", () => {
    render(<WorkingListSection list={LIST} />)
    const section = screen.getByRole("region", {
      name: "Amenity checks, 2 to do",
    })
    expect(
      within(section).getByText(
        "Questions about The Old Crown. Anyone working here can help answer them."
      )
    ).toBeTruthy()
    const titles = within(section)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent)
    expect(titles).toEqual([
      "Is the entrance step-free?",
      "Is there a lift?",
      "Are dogs welcome?",
      "Is there a garden?",
      "Is there Wi-Fi?",
    ])
  })

  it("names each link by its action and question; a closed assignment has none", () => {
    render(<WorkingListSection list={LIST} />)
    expect(
      screen
        .getByRole("link", {
          name: "Add detail: Is the entrance step-free?",
        })
        .getAttribute("href")
    ).toBe("/staff/tasks/amenities/c-att")
    expect(
      screen.getByRole("link", { name: "Start check: Is there a lift?" })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Answer this: Is there a garden?" })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Report a change: Is there Wi-Fi?" })
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Are dogs welcome/ })).toBeNull()
    expect(
      screen.getByText(
        "Answered by Priya on 4 Nov. Your assignment is closed; nothing more to do."
      )
    ).toBeTruthy()
  })

  it("dismisses a closed assignment, hands focus to the heading, and stays quiet if the save fails", async () => {
    const onDismiss = vi.fn(async () => {
      throw new Error("offline")
    })
    render(<WorkingListSection list={LIST} onDismiss={onDismiss} />)
    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss: Are dogs welcome?" })
    )
    expect(onDismiss).toHaveBeenCalledWith({ eventId: 42 })
    expect(screen.queryByText("Are dogs welcome?")).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 2 })
    )
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("renders nothing for a venue with no questions on its list", () => {
    const { container } = render(
      <WorkingListSection list={{ ...LIST, slots: [] }} />
    )
    expect(container.innerHTML).toBe("")
  })
})

describe("To do: a finding that needs attention (§5.2)", () => {
  it("is its own item, counted once even when the check is also assigned to me", () => {
    const items = todoItems(
      tasksView(),
      new Date(),
      0,
      [
        task("c-att", "Is the entrance step-free?"),
        task("c-mine", "Is there a lift?"),
      ],
      LIST.slots
    )
    expect(items.map((item) => item.kind)).toEqual([
      "finding_attention",
      "amenity",
    ])
    expect(todoCount(items)).toBe(2)
  })

  it("leaves open questions, drafts and proposals out of To do", () => {
    const optional = [
      OPEN,
      slot({ checkId: "d", myDraft: { savedAt: "2026-11-05T10:00:00.000Z" } }),
      slot({ checkId: "p", myLatest: finding({ checkId: "p" }) }),
    ]
    expect(todoCount(todoItems(tasksView(), new Date(), 0, [], optional))).toBe(
      0
    )
  })

  it("leads To do with Add detail and the manager's question", () => {
    render(
      <TasksOverview
        tasks={tasksView()}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
        workingList={LIST}
      />
    )
    const todo = screen.getByRole("region", { name: /^To do/ })
    expect(
      within(todo).getByText("Your manager asked: Which door did you check?")
    ).toBeTruthy()
    expect(
      within(todo)
        .getByRole("link", {
          name: "Add detail: Is the entrance step-free?",
        })
        .getAttribute("href")
    ).toBe("/staff/tasks/amenities/c-att")
  })
})

describe("Home: working list beside the legacy checks", () => {
  it("keeps the old list only for assigned checks that aren't on the working list", () => {
    render(
      <TasksOverview
        tasks={tasksView()}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
        amenityTasks={[
          task("c-mine", "Is there a lift?"),
          task("c-old", "Is there a cot?"),
        ]}
        workingList={LIST}
      />
    )
    const lists = screen.getAllByRole("list", { name: "Amenity checks" })
    expect(lists).toHaveLength(2)
    expect(within(lists[1]).getAllByRole("listitem")).toHaveLength(1)
    expect(within(lists[1]).getByText("Is there a cot?")).toBeTruthy()
  })

  it("says To do may be incomplete when the working list can't be read", () => {
    render(
      <TasksOverview
        tasks={tasksView()}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
        workingListError
      />
    )
    expect(
      screen.getByText("We couldn't check your amenity checks.")
    ).toBeTruthy()
    expect(screen.queryByText("Nothing to do right now.")).toBeNull()
  })

  it("shows the notice for what happened to the finding", () => {
    render(
      <TasksOverview
        tasks={tasksView()}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
        findingSent={{
          question: "Is there a lift?",
          copy: {
            title: "Change report sent",
            body: "Until your manager decides, the recorded answer is marked as being checked.",
            tone: "info",
          },
        }}
      />
    )
    const notice = screen.getByRole("status")
    expect(within(notice).getByText("Change report sent")).toBeTruthy()
    expect(notice.textContent).toContain(
      "Is there a lift? Until your manager decides, the recorded answer is marked as being checked."
    )
    expect(notice.textContent).not.toContain("The check is complete.")
  })
})

describe("sentNoticeFor (§4.3)", () => {
  const sent = (over: Partial<FindingSummary>, s: Partial<WorkingSlot> = {}) =>
    sentNoticeFor(slot({ myLatest: finding(over), ...s }))

  it("says it's the venue's answer, with the target line only when it counted", () => {
    expect(
      sent({
        state: "current",
        recognition: { kind: "scored", period: "2026-11" },
      })
    ).toMatchObject({
      title: "Finding sent",
      body: "It's now the venue's answer.",
      tone: "positive",
      extra: "Counted in your November target.",
    })
    expect(
      sent({ state: "current", recognition: { kind: "not_scored" } })
    ).toMatchObject({ extra: null })
  })

  it("tells a change report from a finding that agrees", () => {
    expect(sent({ answer: "no" }, { answerInUse: YES })).toMatchObject({
      title: "Change report sent",
      tone: "info",
    })
    expect(sent({ answer: "yes" }, { answerInUse: YES })).toMatchObject({
      body: "It agrees with the recorded answer; your manager confirms it.",
    })
    expect(sent({})).toMatchObject({
      body: "Your manager confirms it before it's used.",
    })
  })

  it("records Couldn't establish, announces added detail, and a newer draft", () => {
    expect(sent({ answer: "unknown", state: "submitted" })).toMatchObject({
      title: "Recorded",
      tone: "plain",
    })
    expect(sent({ kind: "detail" })).toMatchObject({ title: "Detail sent" })
    expect(
      sent({}, { myDraft: { savedAt: "2026-11-06T10:00:00.000Z" } })
    ).toMatchObject({ title: "Saved for later", tone: "plain" })
  })

  it("says nothing when the finding isn't in a sent state any more", () => {
    expect(sent({ state: "needs_attention" })).toBeNull()
    expect(sent({ state: "no_longer_used" })).toBeNull()
    expect(sentNoticeFor(slot())).toBeNull()
  })
})
