// @vitest-environment jsdom
// B02-06: staff Home and the task send panel.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SubmitPhotosPanel, TasksOverview } from "@/components/nabalens/tasks"
import { ineligibleCopy } from "@/components/nabalens/tasks/copy"
import { MonthlyProgressCard } from "@/components/nabalens/tasks/monthly-progress-card"
import { PhotosSentNotice } from "@/components/nabalens/tasks/photos-sent-notice"
import {
  OFFLINE_SEND,
  STILL_SENDING,
  arrivalNote,
} from "@/components/nabalens/tasks/submit-photos-panel"

import { monthly, needsAnother, photo, tasksView } from "./tasks-fixtures"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const ALSO = { awaitingConfirmation: 2, unknownRecorded: 0 }

describe("This month (HM-15, HM-23)", () => {
  it("shows findings waiting for confirmation without a photo target", () => {
    render(
      <MonthlyProgressCard
        monthly={null}
        periodLabel="November 2026"
        addHref={null}
        canSubmit
        alsoPending={ALSO}
      />
    )
    expect(
      screen.getByText(/Also this month: 2 findings waiting for confirmation/)
    ).toBeTruthy()
  })

  it("draws no bar and no \"of\" without a target number", () => {
    render(
      <MonthlyProgressCard
        monthly={monthly({ targetCount: null })}
        periodLabel="November 2026"
        addHref={null}
        canSubmit
      />
    )
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(document.body.textContent).not.toMatch(/of null|of undefined/)
    expect(screen.getByText("accepted")).toBeTruthy()
  })

  it("keeps the bar and its count with a target", () => {
    render(
      <MonthlyProgressCard
        monthly={monthly()}
        periodLabel="November 2026"
        addHref={null}
        canSubmit
      />
    )
    expect(
      screen.getByRole("progressbar", { name: "3 of 5 photos accepted" })
    ).toBeTruthy()
  })
})

describe("photos sent notice (HM-17)", () => {
  it("takes focus and takes its parameters out of the address", () => {
    window.history.replaceState(
      null,
      "",
      "/staff/tasks?sent=2&task=abc&view=all#todo"
    )
    const replace = vi.spyOn(window.history, "replaceState")
    render(<PhotosSentNotice>2 photos sent to Soup.</PhotosSentNotice>)
    const notice = screen.getByRole("status")
    expect(document.activeElement).toBe(notice)
    expect(replace).toHaveBeenCalledWith(
      null,
      "",
      "/staff/tasks?view=all#todo"
    )
  })
})

describe("send panel copy (UP-20, UP-22, UP-24)", () => {
  it("says a photo was uploaded for another venue, not taken there", () => {
    expect(ineligibleCopy("wrong_venue")).toBe("Uploaded for a different venue.")
  })

  it("counts only processing photos as waiting", () => {
    expect(
      arrivalNote({
        selected: new Set(["a"]),
        waiting: new Set(["b"]),
        blocked: new Set(["c", "d"]),
      })
    ).toBe(
      "1 new photo selected. 1 new photo isn't ready to send yet. 2 new photos can't be sent here; see the reason under each."
    )
  })

  const LIMITS = {
    maxBatchFiles: 10,
    maxParallelUploads: 2,
    maxPhotoBytes: 20 * 1024 * 1024,
    maxVideoBytes: 200 * 1024 * 1024,
  }
  const A = photo({ assetId: "7d000000-0000-4000-8000-00000000000a" })

  function panel(submit = vi.fn(async () => new Promise<never>(() => {}))) {
    return render(
      <SubmitPhotosPanel
        requirementId="6c000000-0000-4000-8000-0000000000aa"
        initialPhotos={{ ok: true, items: [A], nextCursor: null }}
        loadPhotos={vi.fn(async () => ({
          ok: true as const,
          items: [A],
          nextCursor: null,
        }))}
        submit={submit}
        uploader={async () => {}}
        limits={LIMITS}
        onReload={vi.fn()}
        signInHref="/login"
      />
    )
  }

  it("says why Send is off while offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    panel()
    const note = screen.getByText(OFFLINE_SEND)
    const send = screen.getByRole("button", { name: /Select photos to send/ })
    expect(send.getAttribute("aria-describedby")).toBe(note.id)
  })

  it("says it is still sending after 15 seconds", () => {
    vi.useFakeTimers()
    panel()
    fireEvent.click(screen.getAllByRole("button", { pressed: false })[0])
    fireEvent.click(screen.getByRole("button", { name: /Send 1 photo/ }))
    expect(screen.queryByText(STILL_SENDING)).toBeNull()
    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(screen.getByText(STILL_SENDING)).toBeTruthy()
  })
})

describe("To do image labels (HM-18)", () => {
  it("dates a sent photo in London, not as a UTC slice", () => {
    const replace = needsAnother("Too dark.", {
      // 00:30 on 1 July in London (BST).
      submittedAt: "2026-06-30T23:30:00.000Z",
    })
    const { container } = render(
      <TasksOverview
        tasks={tasksView({ needsAnotherPhoto: [replace] })}
        profile={{
          displayName: "TEST Sam",
          venueName: "TEST Venue",
          department: null,
          hasAvatar: true,
        }}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
      />
    )
    const labels = [...container.querySelectorAll("[aria-label]")]
      .map((el) => el.getAttribute("aria-label") ?? "")
      .filter((label) => label.includes("photo sent"))
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      expect(label).toContain("photo sent 1 Jul 2026")
      expect(label).not.toContain("2026-06-30")
    }
  })
})
