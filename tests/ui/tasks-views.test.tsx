// @vitest-environment jsdom
// Staff Home views: setup state, monthly progress, overdue, replacement
// reasons, late acceptance and evidence previews that re-sign when expired.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AssignmentList,
  EvidenceImage,
  MonthCard,
  MonthlyProgressCard,
  NeedsAnotherPhotoList,
  openReplacementRequests,
  pickReplacement,
  ReplacementNote,
  SubmissionList,
  TasksOverview,
  TaskSummary,
  periodLabel,
  shiftPeriod,
  todoCount,
  todoItems,
} from "@/components/nabalens/tasks"
import type { MyAmenityTask } from "@/lib/amenities/contract"

import {
  assignment,
  COLLEAGUE,
  due,
  MANAGER,
  monthly,
  needsAnother,
  PROFILE,
  requirement,
  submission,
  tasksView,
} from "./tasks-fixtures"

afterEach(cleanup)

const base = tasksView()

describe("TasksOverview", () => {
  it.each([
    [1, "1 photo to review"],
    [3, "3 photos to review"],
  ])("offers managers a review card for %i", (count, title) => {
    render(
      <TasksOverview
        tasks={base}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
        reviewCount={count}
      />
    )
    expect(screen.getByRole("heading", { name: title })).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Review photos" }).getAttribute("href")
    ).toBe("/staff/manage/review")
  })

  it("shows no review card when nothing waits", () => {
    render(
      <TasksOverview
        tasks={base}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
      />
    )
    expect(screen.queryByRole("link", { name: "Review photos" })).toBeNull()
  })

  it("shows Needs setup for a missing team and never reads as complete", () => {
    const view = tasksView({
      scope: { ...base.scope, setup: { complete: false, missing: ["team"] } },
      monthly: monthly({
        status: "needs_setup",
        setupMissing: ["team"],
        accepted: 6,
        targetCount: 5,
        complete: false,
      }),
    })
    render(
      <TasksOverview
        tasks={view}
        profile={{ ...PROFILE, department: null }}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
      />
    )
    expect(
      screen.getByRole("heading", { name: "Your setup isn't finished" })
    ).toBeTruthy()
    const steps = screen.getByRole("list", { name: "Profile setup" })
    expect(
      within(steps).getByText("Ask an admin to set your team.")
    ).toBeTruthy()
    expect(within(steps).getByText(PROFILE.venueName)).toBeTruthy()
    expect(screen.getAllByText("Needs setup").length).toBeGreaterThanOrEqual(2)
    expect(
      screen.getByText(/Your team \(FOH or BOH\) isn't set yet/)
    ).toBeTruthy()
    expect(
      screen.getByText(
        "You can still add photos to your profile in the meantime."
      )
    ).toBeTruthy()
    expect(screen.queryByText("Target met")).toBeNull()
    expect(screen.queryByRole("progressbar")).toBeNull()
  })

  it("reads the optional photo step as one sentence with its link inline", () => {
    const view = tasksView({
      scope: { ...base.scope, setup: { complete: false, missing: ["team"] } },
    })
    render(
      <TasksOverview
        tasks={view}
        profile={{ ...PROFILE, department: null, hasAvatar: false }}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
      />
    )
    const step = within(
      screen.getByRole("list", { name: "Profile setup" })
    ).getByText((_, el) =>
      el?.tagName === "LI" ? el.textContent!.startsWith("Profile photo") : false
    )
    expect(step.textContent).toBe(
      "Profile photo (optional). Add one in Edit profile."
    )
    const link = within(step).getByRole("link", { name: "Edit profile" })
    expect(link.getAttribute("href")).toBe("/staff?edit=profile")
  })

  it("explains a missing venue and offers no send action", () => {
    const view = tasksView({
      scope: {
        ...base.scope,
        setup: { complete: false, missing: ["venue"] },
        venue: null,
        canSubmit: false,
      },
      monthly: null,
    })
    render(
      <TasksOverview
        tasks={view}
        profile={{ ...PROFILE, venueName: null }}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
      />
    )
    expect(screen.getByText("Ask an admin to assign your venue.")).toBeTruthy()
    expect(
      screen.getByText("There's no photo target for you this month.")
    ).toBeTruthy()
    expect(
      screen.queryByRole("link", { name: /Add photos for this month/ })
    ).toBeNull()
  })

  it("treats a missing target as Needs setup, not complete", () => {
    render(
      <MonthlyProgressCard
        monthly={monthly({
          status: "needs_setup",
          setupMissing: ["target"],
          targetCount: null,
          accepted: 2,
          complete: false,
        })}
        periodLabel="November 2026"
        addHref="/staff/tasks/month"
        canSubmit
      />
    )
    expect(screen.getByText("Needs setup")).toBeTruthy()
    expect(
      screen.getByText("Your target appears here once your manager sets it.")
    ).toBeTruthy()
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(screen.queryByText("Target met")).toBeNull()
    expect(
      screen.getByRole("link", { name: "Add photos for this month" })
    ).toBeTruthy()
  })

  it("lists assignments, replacements and the at-a-glance counts", () => {
    const starters = assignment({
      due: due({ overdue: true, label: "Due 1 Nov 2026" }),
      progress: { ...requirement().progress, overdue: true },
    })
    const garden = assignment({ kind: "amenity", title: "Garden seating" })
    const replace = needsAnother("Too dark, use the pass lights.", {
      requirement: { id: starters.requirement.id, title: "Starters" },
    })
    render(
      <TasksOverview
        tasks={tasksView({
          assignments: [starters, garden],
          needsAnotherPhoto: [replace],
          pendingReview: 3,
        })}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
      />
    )
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeTruthy()
    const todo = screen.getByRole("region", { name: /To do/ })
    expect(
      within(todo).getByText("TEST Morgan asked for another photo")
    ).toBeTruthy()
    // The replacement request covers the overdue task, so it isn't listed twice.
    expect(within(todo).queryByText("Starters is overdue")).toBeNull()

    expect(screen.getByRole("heading", { name: "All tasks" })).toBeTruthy()
    const tasks = screen.getByRole("list", { name: "Assigned tasks" })
    const link = within(tasks).getByRole("link", { name: "Starters" })
    expect(link.getAttribute("href")).toBe(
      `/staff/tasks/${starters.requirement.id}`
    )
    const card = link.closest("li")!
    expect(within(card).getByText("Overdue")).toBeTruthy()
    expect(within(card).getByText("Needs another photo")).toBeTruthy()
    expect(card.textContent).toContain("shared with 1 colleague")

    expect(screen.getByText("Too dark, use the pass lights.")).toBeTruthy()
    // The replacement answers the original item, so it leaves this list.
    expect(
      screen
        .getByRole("link", { name: "Send another photo for Starters" })
        .getAttribute("href")
    ).toBe(`/staff/tasks/${starters.requirement.id}?replaces=${replace.id}`)
  })

  it("lists tasks overdue first, then by due date, and says when none are assigned", () => {
    const later = assignment({
      title: "Later",
      due: due({ dueAt: "2026-11-30T00:00:00Z" }),
    })
    const sooner = assignment({
      title: "Sooner",
      due: due({ dueAt: "2026-11-10T00:00:00Z" }),
    })
    const late = assignment({
      title: "Late",
      due: due({ overdue: true, dueAt: "2026-11-30T00:00:00Z" }),
      progress: { ...requirement().progress, overdue: true },
    })
    const { unmount } = render(
      <TasksOverview
        tasks={tasksView({ assignments: [later, sooner, late] })}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
      />
    )
    const list = screen.getByRole("list", { name: "Assigned tasks" })
    const names = within(list)
      .getAllByRole("link")
      .map((l) => l.textContent)
    expect(names).toEqual(["Late", "Sooner", "Later"])
    unmount()
    render(
      <TasksOverview
        tasks={tasksView({ assignments: [] })}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
      />
    )
    expect(
      screen.getByText("Nothing is assigned to you this month.")
    ).toBeTruthy()
  })

  it("explains a paused venue", () => {
    render(
      <TasksOverview
        tasks={tasksView({
          scope: {
            ...base.scope,
            venue: { ...base.scope.venue!, active: false },
            canSubmit: false,
          },
        })}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
      />
    )
    expect(screen.getByRole("status").textContent).toMatch(
      /venue isn't taking photos/
    )
  })
})

describe("MonthlyProgressCard", () => {
  it("shows accepted of target, what is left and late acceptances", () => {
    render(
      <MonthlyProgressCard
        monthly={monthly({ accepted: 3, targetCount: 5, lateAcceptances: 1 })}
        periodLabel="November 2026"
        addHref="/staff/tasks/month"
        canSubmit
      />
    )
    expect(
      screen.getByRole("progressbar", { name: "3 of 5 photos accepted" })
    ).toBeTruthy()
    expect(screen.getByText("2 more photos to go.")).toBeTruthy()
    expect(screen.getByText(/1 late acceptance included/)).toBeTruthy()
  })

  it("keeps sending available when overdue", () => {
    render(
      <MonthlyProgressCard
        monthly={monthly({ due: due({ overdue: true }) })}
        periodLabel="November 2026"
        addHref="/staff/tasks/month"
        canSubmit
      />
    )
    expect(screen.getByText("Overdue")).toBeTruthy()
    expect(screen.getByText("You can still send photos.")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Add photos for this month" })
    ).toBeTruthy()
  })

  it("marks a met target and hides overdue once complete", () => {
    render(
      <MonthlyProgressCard
        monthly={monthly({
          accepted: 5,
          targetCount: 5,
          complete: true,
          due: due({ overdue: true }),
        })}
        periodLabel="November 2026"
        addHref={null}
        canSubmit
      />
    )
    expect(screen.getByText("Target met")).toBeTruthy()
    expect(screen.queryByText("Overdue")).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
  })
})

describe("NeedsAnotherPhotoList", () => {
  it("links monthly photos to the month page; closed tasks get no send action", () => {
    const monthlyPhoto = needsAnother("Blurry, hold steady.")
    render(
      <NeedsAnotherPhotoList
        tasksPath="/staff/tasks"
        canSubmit
        openTaskIds={new Set()}
        submissions={[
          monthlyPhoto,
          needsAnother("Wrong section.", {
            requirement: {
              id: "6c000000-0000-4000-8000-000000000999",
              title: "Desserts",
            },
          }),
        ]}
      />
    )
    expect(
      screen
        .getByRole("link", { name: "Send another photo for Monthly photo" })
        .getAttribute("href")
    ).toBe(`/staff/tasks/month?replaces=${monthlyPhoto.id}`)
    expect(
      screen.queryByRole("link", { name: "Send another photo for Desserts" })
    ).toBeNull()
    expect(screen.getByText(/This task is no longer open to you/)).toBeTruthy()
    expect(
      screen.getAllByText(`Reviewed by ${MANAGER.displayName} on 3 Nov 2026`)
    ).toHaveLength(2)
  })
})

describe("replacement note", () => {
  it("always shows the reviewer's reason, or a fallback", () => {
    const { unmount } = render(
      <ReplacementNote
        submission={needsAnother("Too dark, use the pass lights.")}
      />
    )
    expect(screen.getByText("Too dark, use the pass lights.")).toBeTruthy()
    expect(
      screen.getByText("The photos you send now replace this one.")
    ).toBeTruthy()
    unmount()
    render(<ReplacementNote submission={needsAnother("")} />)
    expect(
      screen.getByText("Your reviewer didn't leave a reason.")
    ).toBeTruthy()
  })

  it("explains a request from last month", () => {
    const base = needsAnother("Blurry.")
    render(
      <ReplacementNote
        submission={{
          ...base,
          decision: {
            ...base.decision!,
            decidedAt: "2026-10-30T09:00:00.000Z",
          },
        }}
        currentPeriod="2026-11"
      />
    )
    expect(screen.getByText(/asked in October 2026/)).toBeTruthy()
  })
})

describe("replacement requests", () => {
  const TASK = {
    id: "6c000000-0000-4000-8000-000000000501",
    title: "Back bar shelves",
  }

  it("leaves out answered requests and archived ones from a retired or reconciled task", () => {
    const open = needsAnother("Too dark.", { requirement: TASK })
    const answered = needsAnother("Wrong angle.", { requirement: TASK })
    const archived = needsAnother("Blurry.", {
      requirement: TASK,
      archived: true,
    })
    const replacement = submission({
      requirement: TASK,
      replacesSubmissionId: answered.id,
    })
    expect(
      openReplacementRequests([replacement, archived, answered, open]).map(
        (s) => s.id
      )
    ).toEqual([open.id])
  })

  it("picks the named open request, else the oldest open one, never an archived one", () => {
    const newer = needsAnother("Too dark.", { requirement: TASK })
    const older = needsAnother("Wrong angle.", { requirement: TASK })
    const archived = needsAnother("Blurry.", {
      requirement: TASK,
      archived: true,
    })
    const open = openReplacementRequests([newer, older, archived])
    expect(pickReplacement(open, newer.id)?.id).toBe(newer.id)
    expect(pickReplacement(open, null)?.id).toBe(older.id)
    expect(pickReplacement(open, archived.id)?.id).toBe(older.id)
    expect(
      pickReplacement(openReplacementRequests([archived]), archived.id)
    ).toBeNull()
  })

  it("shows which photo a send replaces and why", () => {
    render(
      <ReplacementNote
        submission={needsAnother("Too dark.", { requirement: TASK })}
      />
    )
    expect(
      screen.getByText("The photos you send now replace this one.")
    ).toBeTruthy()
    expect(screen.getByText("Too dark.")).toBeTruthy()
    expect(
      screen.getByRole("button", {
        name: /^View larger: Photo that needs another, sent /,
      })
    ).toBeTruthy()
  })
})

describe("SubmissionList", () => {
  it("marks late acceptance, removed evidence and manager-added photos", () => {
    render(
      <SubmissionList
        label="Your photos for this task"
        showTask
        empty="None yet."
        submissions={[
          submission({
            state: "accepted",
            period: "2026-10",
            decision: {
              decision: "accept",
              reason: null,
              decidedAt: "2026-11-02T09:00:00.000Z",
              decidedBy: MANAGER,
              selfReview: false,
              lateAcceptance: true,
            },
          }),
          submission({
            state: "accepted",
            asset: {
              ...submission().asset,
              thumbnailUrl: null,
              previewUrl: null,
              available: false,
            },
          }),
          submission({
            origin: "attached",
            submittedById: MANAGER.id,
            countsTowardMonthly: false,
            requirement: {
              id: "6c000000-0000-4000-8000-000000000123",
              title: "Bar area",
            },
          }),
        ]}
      />
    )
    const rows = within(
      screen.getByRole("list", { name: "Your photos for this task" })
    ).getAllByRole("listitem")
    expect(rows).toHaveLength(3)
    expect(
      within(rows[0]).getByText("Accepted late · counts for October 2026")
    ).toBeTruthy()
    expect(
      within(rows[0]).getByText(
        `Accepted by ${MANAGER.displayName} on 2 Nov 2026`
      )
    ).toBeTruthy()
    expect(within(rows[1]).getByText("Photo removed")).toBeTruthy()
    expect(within(rows[1]).queryByRole("button")).toBeNull()
    expect(
      within(rows[2]).getByText("Added to this task by a manager on 2 Nov 2026")
    ).toBeTruthy()
    expect(
      within(rows[2]).getByText(
        "Counts for the task only, not your monthly target."
      )
    ).toBeTruthy()
  })

  it("opens a larger preview from the thumbnail", async () => {
    const sent = submission()
    render(<SubmissionList label="Sent" empty="None." submissions={[sent]} />)
    await userEvent.setup().click(
      screen.getByRole("button", {
        name: "View larger: Photo sent 2 Nov 2026",
      })
    )
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog)
        .getByRole("img", { name: "Photo sent 2 Nov 2026" })
        .getAttribute("src")
    ).toBe(sent.asset.previewUrl)
  })
})

describe("TaskSummary", () => {
  it("shows guidance, overdue follow-up and who shares the task", () => {
    render(
      <TaskSummary assignment={assignment({ due: due({ overdue: true }) })} />
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Starters" })
    ).toBeTruthy()
    expect(
      screen.getByText("Show three different starters on the pass.")
    ).toBeTruthy()
    expect(screen.getByText("Overdue")).toBeTruthy()
    expect(
      screen.getByText(/It's past its due date\. You can still send photos/)
    ).toBeTruthy()
    expect(screen.getByText(COLLEAGUE.displayName)).toBeTruthy()
  })

  it("marks a task that no longer takes photos", () => {
    render(
      <TaskSummary
        assignment={assignment({ status: "retired", isCurrent: false })}
      />
    )
    expect(screen.getByText("Closed")).toBeTruthy()
    expect(screen.queryByText(/past its due date/)).toBeNull()
  })
})

describe("AssignmentList", () => {
  it("marks satisfied tasks complete without an overdue chip", () => {
    render(
      <AssignmentList
        tasksPath="/staff/tasks"
        needsAnotherPhoto={new Set()}
        assignments={[
          assignment({
            due: due({ overdue: true }),
            progress: {
              ...requirement().progress,
              accepted: 4,
              satisfied: true,
              overdue: true,
            },
          }),
          assignment({ title: "Old desserts", isCurrent: false }),
        ]}
      />
    )
    expect(screen.getByText("Complete")).toBeTruthy()
    expect(screen.queryByText("Overdue")).toBeNull()
    expect(screen.getByText("Closed")).toBeTruthy()
  })
})

describe("EvidenceImage", () => {
  const src =
    "/api/coverage/evidence/5b000000-0000-4000-8000-000000000001/thumb"
  // Browsers report a failed load as complete with no pixels, and a new src as
  // not complete while it loads; jsdom never loads images, so model that here.
  const failedUrls = new Set<string>()
  beforeEach(() => {
    failedUrls.clear()
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockImplementation(
      function (this: HTMLImageElement) {
        return failedUrls.has(this.getAttribute("src") ?? "")
      }
    )
  })
  afterEach(() => vi.restoreAllMocks())

  function failLoad(img: HTMLImageElement) {
    failedUrls.add(img.getAttribute("src")!)
    act(() => {
      fireEvent.error(img)
    })
  }

  it("re-signs an expired link once, then offers Try again", async () => {
    const { container } = render(
      <EvidenceImage src={src} alt="Starters photo" />
    )
    const img = () => container.querySelector("img")!
    expect(img().getAttribute("src")).toBe(src)

    failLoad(img())
    expect(img().getAttribute("src")).toBe(`${src}?r=1`)

    failLoad(img())
    expect(container.querySelector("img")).toBeNull()
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Try again/ }))
    expect(img().getAttribute("src")).toBe(`${src}?r=2`)
  })

  it("counts a load that failed before hydration once, not twice", () => {
    // The server-rendered image already failed: the mount check sees it...
    failedUrls.add(src)
    const { container } = render(<EvidenceImage src={src} />)
    const img = () => container.querySelector("img")!
    expect(img().getAttribute("src")).toBe(`${src}?r=1`)
    // ...and React's replayed error event arrives while ?r=1 is loading.
    act(() => {
      fireEvent.error(img())
    })
    expect(img().getAttribute("src")).toBe(`${src}?r=1`)
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull()
  })
})

describe("period helpers", () => {
  it("labels and shifts calendar months without time-zone math", () => {
    expect(periodLabel("2026-10")).toBe("October 2026")
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12")
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01")
  })
})

describe("Home: From your colleagues", () => {
  const post = (n: number) => ({
    id: `m${n}`,
    mediaType: "image" as const,
    uploadState: "ready" as const,
    thumbnailUrl: `/thumb/${n}`,
    previewUrl: `/preview/${n}`,
    mimeType: "image/jpeg",
    originalFilename: null,
    createdAt: "2026-11-02T12:00:00Z",
    contributorId: `c${n}`,
    contributorName: `Colleague ${n}`,
    venueName: "The Railway",
    width: null,
    height: null,
    durationSeconds: null,
    sizeBytes: null,
    labels: null,
  })
  const overview = (colleagues: ReturnType<typeof post>[]) =>
    render(
      <TasksOverview
        tasks={base}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
        colleagues={colleagues}
      />
    )

  it("shows at most three posts below To do with a See more photos link", () => {
    overview([1, 2, 3, 4, 5].map(post))
    const heading = screen.getByRole("heading", {
      name: "From your colleagues",
    })
    const todo = screen.getByRole("heading", { name: /^To do/ })
    expect(
      todo.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Colleague 1's profile" })
    ).toBeTruthy()
    expect(
      screen.getByAltText(
        "Photo by Colleague 1, The Railway, uploaded 2 Nov 2026"
      )
    ).toBeTruthy()
    expect(screen.queryByAltText(/Colleague 4/)).toBeNull()
    expect(
      screen.getByRole("link", { name: "See more photos" }).getAttribute("href")
    ).toBe("/staff/community")
  })

  it("is hidden when there are no posts", () => {
    overview([])
    expect(screen.queryByText("From your colleagues")).toBeNull()
    expect(screen.queryByText("See more photos")).toBeNull()
  })
})

describe("MonthCard", () => {
  it("leads with the replace link and keeps adding secondary", () => {
    render(
      <MonthCard
        monthly={monthly({ accepted: 1, pending: 1, targetCount: 5 })}
        periodLabel="November 2026"
        replaceHref="/staff/tasks/month?replaces=abc#add-heading"
        replaceCount={1}
        addHref="#add-heading"
      />
    )
    expect(screen.getByLabelText("1 of 5 photos accepted")).toBeTruthy()
    expect(screen.getByText("1 waiting for review")).toBeTruthy()
    expect(screen.getByText("3 to take")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "1 photo to replace" })
        .getAttribute("href")
    ).toBe("/staff/tasks/month?replaces=abc#add-heading")
    expect(
      screen.getByRole("link", { name: "Add photos for this month" })
    ).toBeTruthy()
  })

  it("shows Needs setup without a count, and Read-only without actions", () => {
    const { rerender } = render(
      <MonthCard
        monthly={monthly({ status: "needs_setup", targetCount: null })}
        periodLabel="November 2026"
      />
    )
    expect(screen.getByText("Needs setup")).toBeTruthy()
    expect(screen.queryByText(/accepted/)).toBeNull()
    rerender(
      <MonthCard
        monthly={monthly({ accepted: 4, targetCount: 5 })}
        periodLabel="October 2026"
        readOnly
      />
    )
    expect(screen.getByText("Read-only")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })
})

function amenityCheck(
  id: string,
  question: string,
  overrides: Partial<MyAmenityTask> = {}
): MyAmenityTask {
  return {
    id,
    venueId: "v1",
    entry: {
      key: id,
      category: "Access",
      question,
      captureBrief: "Film the route in.",
      evidenceRule: "photo",
      isCore: true,
      position: 1,
      version: 1,
    },
    status: "active",
    progress: "needs_capture",
    answer: "to_check",
    assignee: { id: "me", displayName: "TEST Sam" },
    answeredBy: null,
    answeredAt: null,
    recheckReason: null,
    notes: null,
    revision: 1,
    updatedAt: "2026-11-05T10:00:00.000Z",
    ...overrides,
  }
}

describe("To do: amenity checks", () => {
  const checks = [
    amenityCheck("c1", "Is there step-free access?"),
    amenityCheck("c2", "Is there guest Wi-Fi?", {
      progress: "needs_recheck",
      recheckReason: "Password or QR visible",
    }),
  ]

  it("counts every assigned check in To do and the badge", () => {
    const items = todoItems(base, new Date("2026-11-05T10:00:00Z"), 0, checks)
    expect(items.map((i) => i.kind)).toEqual(["amenity"])
    expect(todoCount(items)).toBe(2)
    expect(todoCount(todoItems(base, new Date(), 2, checks))).toBe(3)
  })

  it("never says nothing to do while a check waits, and leads with the recheck", () => {
    render(
      <TasksOverview
        tasks={base}
        profile={PROFILE}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
        amenityTasks={checks}
      />
    )
    expect(screen.queryByText("Nothing to do right now.")).toBeNull()
    const todo = screen.getByRole("region", { name: /^To do/ })
    expect(within(todo).getByText("2")).toBeTruthy()
    expect(
      within(todo).getByRole("heading", { name: "Is there guest Wi-Fi?" })
    ).toBeTruthy()
    expect(within(todo).getByText("Password or QR visible")).toBeTruthy()
    expect(within(todo).getByText(/1 more check below/)).toBeTruthy()
    const start = within(todo).getByRole("link", {
      name: "Start check: Is there guest Wi-Fi?",
    })
    expect(start.getAttribute("href")).toBe("/staff/tasks/amenities/c2")
    // The lead card's action is the page's one primary button.
    expect(start.className).toContain("w-full")
    // The full list still follows To do.
    expect(
      screen.getByRole("list", { name: "Amenity checks" }).children
    ).toHaveLength(2)
  })

  it("puts overdue photo tasks before amenity checks and due-soon tasks after", () => {
    const view = tasksView({
      assignments: [
        assignment({
          id: "r-overdue",
          title: "Bar",
          progress: { ...requirement().progress, overdue: true },
          due: due({ overdue: true }),
        }),
        assignment({
          id: "r-soon",
          title: "Terrace",
          due: due({ dueAt: "2026-11-07T00:00:00.000Z" }),
        }),
      ],
    })
    const kinds = todoItems(
      view,
      new Date("2026-11-05T10:00:00Z"),
      0,
      checks
    ).map((i) => i.kind)
    expect(kinds).toEqual(["overdue", "amenity", "due-soon"])
  })
})
