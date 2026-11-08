// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  COVERAGE_LIMITS,
  MenuCoveragePanel,
  PrepareMonthButton,
  TeamRoster,
  lastDayOfPeriod,
  targetReasonRequired,
  type MenuCoverageHandlers,
  type PreparationRunView,
  type SetTargetHandler,
} from "@/components/nabalens/coverage"
import { LIMITS } from "@/lib/server/coverage/validate"

import {
  MANAGER_ID,
  PERIOD,
  STAFF_ID,
  menuView,
  monthly,
  person,
  requirement,
  submission,
} from "./coverage-fixtures"

afterEach(cleanup)

describe("coverage limits", () => {
  it("match the services' limits", () => {
    for (const [key, value] of Object.entries(COVERAGE_LIMITS)) {
      expect(LIMITS[key as keyof typeof LIMITS], key).toBe(value)
    }
  })

  it("computes London calendar month ends, including leap years", () => {
    expect(lastDayOfPeriod("2026-11")).toBe("2026-11-30")
    expect(lastDayOfPeriod("2028-02")).toBe("2028-02-29")
    expect(lastDayOfPeriod("2026-02")).toBe("2026-02-28")
    expect(lastDayOfPeriod("bad")).toBe("")
  })
})

describe("TeamRoster", () => {
  const ok = async () => ({ ok: true as const, revision: 3 })
  const past = {
    ...PERIOD,
    key: "2026-10",
    label: "October 2026",
    isCurrent: false,
  }

  it("shows names, teams and progress only, Needs setup first and never met", () => {
    render(
      <TeamRoster
        period={PERIOD}
        currentPeriod="2026-11"
        rows={[
          monthly(),
          monthly({
            person: person({
              id: "p-new",
              displayName: "TEST Joiner",
              department: null,
            }),
            targetId: "t-2",
            status: "needs_setup",
            setupMissing: ["team", "target"],
            targetCount: null,
            source: "placeholder",
            complete: false,
            accepted: 3,
          }),
        ]}
        canEdit
        isAdmin={false}
        basePath="/staff/manage"
      />
    )
    expect(
      screen.getByText("Needs setup first, then A to Z by surname.")
    ).toBeTruthy()
    const list = screen.getByRole("list", {
      name: "Team targets, November 2026",
    })
    const rows = within(list).getAllByRole("listitem")
    expect(within(rows[0]).getByText("TEST Joiner")).toBeTruthy()
    expect(within(rows[0]).getByText("No team")).toBeTruthy()
    expect(
      within(rows[0]).getByText("Set a target. An admin assigns the team.")
    ).toBeTruthy()
    expect(within(rows[0]).getByText("Needs setup")).toBeTruthy()
    expect(within(rows[0]).queryByText("Target met")).toBeNull()
    expect(within(rows[0]).queryByText(/accepted/)).toBeNull()
    expect(within(rows[1]).getByText("of 5 accepted")).toBeTruthy()
    expect(within(rows[1]).getByText("FOH")).toBeTruthy()
    expect(within(rows[1]).getByText("Bartender")).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/@/)
    expect(
      within(rows[1])
        .getByRole("link", { name: /TEST Sam/ })
        .getAttribute("href")
    ).toBe(`/staff/manage/team?staff=${STAFF_ID}&period=2026-11`)
  })

  it("orders people A to Z by surname, never by progress", () => {
    render(
      <TeamRoster
        period={PERIOD}
        currentPeriod="2026-11"
        rows={[
          monthly({
            person: person({ id: "p-1", displayName: "TEST Amy Young" }),
            accepted: 5,
            complete: true,
          }),
          monthly({
            person: person({ id: "p-2", displayName: "TEST Zed Adams" }),
            accepted: 0,
          }),
        ]}
        canEdit={false}
        isAdmin={false}
        basePath="/staff/manage"
      />
    )
    const rows = within(
      screen.getByRole("list", { name: "Team targets, November 2026" })
    ).getAllByRole("listitem")
    expect(within(rows[0]).getByText("TEST Zed Adams")).toBeTruthy()
    expect(within(rows[1]).getByText("TEST Amy Young")).toBeTruthy()
    expect(screen.getByText("1 of 2 met their target")).toBeTruthy()
  })

  it("requires a reason to change a set current-month target", async () => {
    const user = userEvent.setup()
    const onSetTarget = vi.fn<SetTargetHandler>(ok)
    render(
      <TeamRoster
        period={PERIOD}
        currentPeriod="2026-11"
        rows={[monthly()]}
        canEdit
        isAdmin={false}
        basePath="/staff/manage"
        onSetTarget={onSetTarget}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Increase TEST Sam's photo target" })
    )
    expect(
      (screen.getByLabelText("TEST Sam's photo target") as HTMLInputElement)
        .value
    ).toBe("6")
    expect(screen.getByText("1 change not saved")).toBeTruthy()
    expect(screen.getByText("Was 5 · set by a manager")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Save targets" }))
    expect(
      screen.getByText("Add a reason. It's saved with the change.")
    ).toBeTruthy()
    expect(onSetTarget).not.toHaveBeenCalled()
    await user.type(
      screen.getByLabelText("Reason for changing November's target"),
      "Extra shifts"
    )
    await user.click(screen.getByRole("button", { name: "Save targets" }))
    expect(onSetTarget).toHaveBeenCalledWith({
      staffId: STAFF_ID,
      period: "2026-11",
      targetCount: 6,
      dueOn: "2026-11-30",
      reason: "Extra shifts",
      expectedRevision: 2,
    })
    expect(
      await screen.findByText(
        "Saved. TEST's November target is 6, changed from 5. The reason is kept with it."
      )
    ).toBeTruthy()
    expect(screen.queryByText("1 change not saved")).toBeNull()
  })

  it("rejects a target over the limit before sending", async () => {
    const user = userEvent.setup()
    const onSetTarget = vi.fn<SetTargetHandler>(ok)
    render(
      <TeamRoster
        period={PERIOD}
        currentPeriod="2026-11"
        rows={[monthly()]}
        canEdit
        isAdmin={false}
        basePath="/staff/manage"
        onSetTarget={onSetTarget}
      />
    )
    const input = screen.getByLabelText("TEST Sam's photo target")
    await user.clear(input)
    await user.type(input, String(COVERAGE_LIMITS.targetCountMax + 1))
    await user.type(
      screen.getByLabelText("Reason for changing November's target"),
      "Busy month"
    )
    await user.click(screen.getByRole("button", { name: "Save targets" }))
    expect(
      screen.getByText(
        `Targets can be up to ${COVERAGE_LIMITS.targetCountMax} photos.`
      )
    ).toBeTruthy()
    expect(onSetTarget).not.toHaveBeenCalled()
  })

  it("sets a first target without a reason and keeps the due date in the month", async () => {
    const user = userEvent.setup()
    const onSetTarget = vi.fn<SetTargetHandler>(ok)
    render(
      <TeamRoster
        period={PERIOD}
        currentPeriod="2026-11"
        rows={[
          monthly({
            status: "needs_setup",
            setupMissing: ["target"],
            targetCount: null,
            source: "placeholder",
            due: null,
          }),
        ]}
        canEdit
        isAdmin={false}
        basePath="/staff/manage"
        onSetTarget={onSetTarget}
      />
    )
    await user.type(screen.getByLabelText("TEST Sam's photo target"), "4")
    expect(screen.getByText("First target · no reason needed")).toBeTruthy()
    expect(
      screen.queryByLabelText("Reason for changing November's target")
    ).toBeNull()
    const changeDue = screen.getByRole("button", {
      name: "Change due date for TEST Sam",
    })
    // WCAG 2.5.3: the accessible name starts with the visible label.
    expect(changeDue.textContent).toBe("Change due date")
    await user.click(changeDue)
    const due = screen.getByLabelText("Due date")
    expect(due.getAttribute("min")).toBe("2026-11-01")
    expect(due.getAttribute("max")).toBe("2026-11-30")
    await user.click(screen.getByRole("button", { name: "Save targets" }))
    expect(onSetTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        targetCount: 4,
        reason: null,
        dueOn: "2026-11-30",
        expectedRevision: 2,
      })
    )
  })

  it("before the month is prepared, says targets can be set now and saves them", async () => {
    const user = userEvent.setup()
    const onSetTarget = vi.fn<SetTargetHandler>(ok)
    render(
      <TeamRoster
        period={PERIOD}
        currentPeriod="2026-11"
        rows={[
          monthly({
            targetId: null,
            revision: null,
            status: "needs_setup",
            setupMissing: ["target"],
            targetCount: null,
            source: null,
            due: null,
          }),
        ]}
        canEdit
        isAdmin
        basePath="/admin/coverage/v-1"
        onSetTarget={onSetTarget}
      />
    )
    const hint = screen.getByText(
      "You can set targets now. Preparing November keeps the ones you set and copies last month's targets for everyone else."
    )
    const field = screen.getByLabelText("TEST Sam's photo target")
    expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(
      hint.id
    )
    await user.type(field, "4")
    await user.click(screen.getByRole("button", { name: "Save targets" }))
    expect(onSetTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        targetCount: 4,
        reason: null,
        expectedRevision: null,
      })
    )
  })

  it("once the month is prepared, has no before-preparing hint", () => {
    render(
      <TeamRoster
        period={PERIOD}
        currentPeriod="2026-11"
        rows={[monthly()]}
        canEdit
        isAdmin
        basePath="/admin/coverage/v-1"
        onSetTarget={vi.fn<SetTargetHandler>(ok)}
      />
    )
    expect(screen.queryByText(/You can set targets now/)).toBeNull()
  })

  it("re-reads the page on a conflict and moves focus to the page notice", async () => {
    const user = userEvent.setup()
    const onStale = vi.fn()
    const onSetTarget = vi.fn<SetTargetHandler>(async () => ({
      ok: false,
      code: "revision_conflict",
      status: 409,
      message: "This changed while you were looking at it.",
      currentRevision: 2,
    }))
    render(
      <TeamRoster
        period={PERIOD}
        currentPeriod="2026-11"
        rows={[monthly()]}
        canEdit
        isAdmin={false}
        basePath="/staff/manage"
        onSetTarget={onSetTarget}
        onStale={onStale}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Increase TEST Sam's photo target" })
    )
    await user.type(
      screen.getByLabelText("Reason for changing November's target"),
      "Extra shifts"
    )
    await user.click(screen.getByRole("button", { name: "Save targets" }))
    const text = await screen.findByText(
      /Someone else changed this a moment ago/
    )
    expect(onStale).toHaveBeenCalledTimes(1)
    const notice = text.closest<HTMLElement>('[data-slot="notice"]')!
    expect(notice.getAttribute("role")).toBe("status")
    expect(screen.queryByRole("alert")).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(notice))
  })

  it("keeps drafts within their month when the next target has the same revision", async () => {
    const user = userEvent.setup()
    const onSetTarget = vi.fn<SetTargetHandler>(ok)
    const props = {
      period: PERIOD,
      currentPeriod: PERIOD.key,
      canEdit: true,
      isAdmin: false,
      basePath: "/staff/manage",
      onSetTarget,
    }
    const december = {
      ...PERIOD,
      key: "2026-12",
      label: "December 2026",
      startsAt: "2026-12-01T00:00:00.000Z",
      endsAt: "2027-01-01T00:00:00.000Z",
      isCurrent: false,
    }
    const targetInput = () => screen.getByLabelText("TEST Sam's photo target")
    const openDueDate = () =>
      user.click(
        screen.getByRole("button", { name: "Change due date for TEST Sam" })
      )
    const { rerender } = render(<TeamRoster {...props} rows={[monthly()]} />)

    await user.click(
      screen.getByRole("button", { name: "Increase TEST Sam's photo target" })
    )
    await user.type(
      screen.getByLabelText("Reason for changing November's target"),
      "Extra November shifts"
    )
    await openDueDate()
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-11-18" },
    })

    rerender(<TeamRoster {...props} rows={[monthly({ accepted: 3 })]} />)
    expect(targetInput()).toHaveProperty("value", "6")
    expect(screen.getByLabelText("Due date")).toHaveProperty(
      "value",
      "2026-11-18"
    )
    expect(
      screen.getByLabelText("Reason for changing November's target")
    ).toHaveProperty("value", "Extra November shifts")

    rerender(
      <TeamRoster
        {...props}
        period={december}
        rows={[
          monthly({
            period: december,
            targetId: "dddddddd-0000-4000-8000-000000000002",
            targetCount: 8,
            due: null,
          }),
        ]}
      />
    )
    expect(targetInput()).toHaveProperty("value", "8")
    expect(screen.queryByLabelText("Due date")).toBeNull()
    expect(
      screen.queryByLabelText("Reason for changing December's target")
    ).toBeNull()
    expect(screen.queryByRole("button", { name: "Save targets" })).toBeNull()
    await openDueDate()
    expect(screen.getByLabelText("Due date")).toHaveProperty(
      "value",
      "2026-12-31"
    )
    expect(onSetTarget).not.toHaveBeenCalled()
  })

  it("drops an unsaved change when a refresh brings a newer target", async () => {
    const user = userEvent.setup()
    const onSetTarget = vi.fn<SetTargetHandler>(async () => ({
      ok: false,
      code: "revision_conflict",
      status: 409,
      message: "This changed while you were looking at it.",
      currentRevision: 3,
    }))
    const props = {
      period: PERIOD,
      currentPeriod: "2026-11",
      canEdit: true,
      isAdmin: false,
      basePath: "/staff/manage",
      onSetTarget,
    }
    const { rerender } = render(<TeamRoster {...props} rows={[monthly()]} />)
    await user.click(
      screen.getByRole("button", { name: "Increase TEST Sam's photo target" })
    )
    await user.type(
      screen.getByLabelText("Reason for changing November's target"),
      "Extra shifts"
    )
    await user.click(screen.getByRole("button", { name: "Save targets" }))
    await screen.findByText(/Someone else changed this a moment ago/)

    // The re-read brings someone else's change as a new revision.
    rerender(
      <TeamRoster
        {...props}
        rows={[monthly({ targetCount: 8, revision: 3 })]}
      />
    )
    const input = screen.getByLabelText(
      "TEST Sam's photo target"
    ) as HTMLInputElement
    expect(input.value).toBe("8")
    expect(screen.queryByText("1 change not saved")).toBeNull()
    expect(
      screen.queryByLabelText("Reason for changing November's target")
    ).toBeNull()

    onSetTarget.mockResolvedValueOnce({ ok: true, revision: 4 })
    await user.clear(input)
    await user.type(input, "9")
    await user.type(
      screen.getByLabelText("Reason for changing November's target"),
      "Agreed with Sam"
    )
    await user.click(screen.getByRole("button", { name: "Save targets" }))
    expect(onSetTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetCount: 9, expectedRevision: 3 })
    )
  })

  it("lists people who moved away apart, without a target to edit", () => {
    render(
      <TeamRoster
        period={PERIOD}
        currentPeriod="2026-11"
        rows={[
          monthly(),
          monthly({
            person: person({ id: "p-moved", displayName: "TEST Rina" }),
            isCurrentMember: false,
          }),
        ]}
        canEdit
        isAdmin={false}
        basePath="/staff/manage"
        onSetTarget={vi.fn()}
      />
    )
    const moved = screen.getByRole("list", { name: "Moved away this month" })
    expect(within(moved).getByText("TEST Rina")).toBeTruthy()
    expect(
      within(moved).getByText("Photos sent before the move still count here.")
    ).toBeTruthy()
    expect(within(moved).queryByRole("button")).toBeNull()
    expect(screen.getByText("0 of 1 met their target")).toBeTruthy()
  })

  it("keeps past months read-only for managers", () => {
    render(
      <TeamRoster
        period={past}
        currentPeriod="2026-11"
        rows={[monthly({ period: past })]}
        canEdit={false}
        isAdmin={false}
        basePath="/staff/manage"
        onSetTarget={vi.fn()}
      />
    )
    expect(screen.getByText("5 photos")).toBeTruthy()
    expect(screen.getByText("Set by a manager")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /target/ })).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(
      targetReasonRequired({ targetCount: null, source: null }, "past")
    ).toBe(true)
    expect(
      targetReasonRequired({ targetCount: 3, source: "copied" }, "current")
    ).toBe(true)
    expect(
      targetReasonRequired(
        { targetCount: null, source: "placeholder" },
        "current"
      )
    ).toBe(false)
    expect(
      targetReasonRequired({ targetCount: 3, source: "manager" }, "future")
    ).toBe(false)
  })

  it("lets an admin correct a past month's target with a reason", async () => {
    const user = userEvent.setup()
    const onSetTarget = vi.fn<SetTargetHandler>(ok)
    render(
      <TeamRoster
        period={past}
        currentPeriod="2026-11"
        rows={[monthly({ period: past })]}
        canEdit
        isAdmin
        basePath="/admin/coverage/v-1"
        venueName="TEST Venue"
        onSetTarget={onSetTarget}
      />
    )
    expect(screen.queryByRole("button", { name: /photo target/ })).toBeNull()
    const correct = screen.getByRole("button", {
      name: "Correct target for TEST Sam, October",
    })
    expect(correct.textContent).toBe("Correct target")
    await user.click(correct)
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText("Correct TEST Sam's October target")
    ).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", {
        name: "Decrease TEST Sam's October target",
      })
    )
    expect(
      within(dialog).getByText(
        "Was 5. With 4, TEST's October shows 2 of 4 accepted. Venue coverage isn't affected."
      )
    ).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: "Save correction" })
    )
    expect(
      within(dialog).getByText("Add a reason. It's kept in October's history.")
    ).toBeTruthy()
    expect(onSetTarget).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText("Reason"), "On leave")
    await user.click(
      within(dialog).getByRole("button", { name: "Save correction" })
    )
    expect(onSetTarget).toHaveBeenCalledWith({
      staffId: STAFF_ID,
      period: "2026-10",
      targetCount: 4,
      dueOn: "2026-11-30",
      reason: "On leave",
      expectedRevision: 2,
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(
      screen.getByText(
        "TEST's October target is now 4. The correction and its reason are kept in October's history."
      )
    ).toBeTruthy()
  })
})

describe("PrepareMonthButton", () => {
  const run = (overrides: Partial<PreparationRunView> = {}) => ({
    id: "run-1",
    period: "2026-11",
    venueId: "v-1",
    trigger: "manual" as const,
    startedAt: "2026-11-03T10:00:00.000Z",
    finishedAt: "2026-11-03T10:00:01.000Z",
    status: "succeeded" as const,
    staffConsidered: 11,
    targetsCopied: 9,
    placeholdersCreated: 2,
    alreadyPresent: 0,
    candidatesAdded: 0,
    errorCode: null,
    ...overrides,
  })

  it("says what it will do, then what happened, and stays open after the page re-reads", async () => {
    const user = userEvent.setup()
    const onPrepare = vi.fn(async () => ({ ok: true as const, runs: [run()] }))
    const props = {
      period: "2026-11",
      venueName: "TEST Venue",
      onPrepare,
    }
    const { rerender } = render(<PrepareMonthButton {...props} available />)
    await user.click(screen.getByRole("button", { name: "Prepare this month" }))
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText("Prepare November at TEST Venue")
    ).toBeTruthy()
    expect(
      within(dialog).getByText("Copies October's targets at TEST Venue.")
    ).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: "Prepare this month" })
    )
    expect(await within(dialog).findByText("November is prepared")).toBeTruthy()
    expect(onPrepare).toHaveBeenCalledTimes(1)
    rerender(<PrepareMonthButton {...props} available={false} />)
    expect(screen.getByText("November is prepared")).toBeTruthy()
  })

  it("reports a failed run without claiming anything was copied twice", async () => {
    const user = userEvent.setup()
    const onPrepare = vi.fn(async () => ({
      ok: true as const,
      runs: [run({ status: "failed", errorCode: "40001" })],
    }))
    render(
      <PrepareMonthButton
        period="2026-11"
        venueName="TEST Venue"
        onPrepare={onPrepare}
      />
    )
    await user.click(screen.getByRole("button", { name: "Prepare this month" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("button", { name: "Prepare this month" })
    )
    expect(
      await within(dialog).findByText("Preparing November didn't finish")
    ).toBeTruthy()
    expect(
      within(dialog).getByText(
        "Targets were copied for 9 of 11 people. 2 need you to set them on Team. Nothing was copied twice."
      )
    ).toBeTruthy()
    expect(
      within(dialog).getByRole("button", { name: "Try again" })
    ).toBeTruthy()
  })
})

describe("MenuCoveragePanel", () => {
  const handlers = (): MenuCoverageHandlers => ({
    start: vi.fn(async () => ({ ok: true as const })),
    confirm: vi.fn(async () => ({ ok: true as const })),
    discard: vi.fn(async () => ({ ok: true as const })),
    reconcile: vi.fn(async () => ({ ok: true as const })),
  })

  const section = (
    id: string,
    name: string,
    planStatus: "draft" | "confirmed" | "superseded",
    status: "needs_setup" | "active" = "active"
  ) =>
    requirement({
      id,
      kind: "menu_section",
      title: name,
      templateKey: null,
      status,
      setupIssues: status === "needs_setup" ? ["unconfirmed"] : [],
      menuSection: {
        menuPlanId: `plan-${planStatus}`,
        menuPlanStatus: planStatus,
        menuVersionId: "v",
        sectionName: name,
        sectionSlug: null,
        sectionKind: "food",
        position: 0,
        itemCount: 4,
      },
    })

  it("starts coverage from the active menu without publishing anything", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(
      <MenuCoveragePanel
        menu={menuView({ menuState: "needs_setup" })}
        evidence={{}}
        basePath="/staff/manage"
        handlers={h}
      />
    )
    expect(screen.getByText("Starters")).toBeTruthy()
    expect(screen.getByText(/Dishes do not each need a photo/)).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: "Start from this menu" })
    )
    expect(h.start).toHaveBeenCalledWith("eeeeeeee-0000-4000-8000-000000000002")
  })

  it("blocks confirming a plan while sections need setup", () => {
    render(
      <MenuCoveragePanel
        menu={menuView({
          menuState: "needs_setup",
          draftPlan: {
            id: "plan-draft",
            status: "draft",
            menuVersionId: "v",
            revision: 2,
            reconciliationRequired: false,
            reconciledAt: null,
            confirmedAt: null,
            createdAt: "2026-11-02T09:00:00.000Z",
          },
          draft: [
            section("d-1", "Starters", "draft", "needs_setup"),
            section("d-2", "Cocktails", "draft"),
          ],
        })}
        evidence={{}}
        basePath="/staff/manage"
        handlers={handlers()}
      />
    )
    expect(screen.getByText(/1 of 2 sections set up/)).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Confirm menu coverage" })
        .hasAttribute("disabled")
    ).toBe(true)
    expect(screen.getByText(/Set up or exclude 1 more section/)).toBeTruthy()
  })

  it("shows the menu-changed banner and reconciles only by explicit choice", async () => {
    const user = userEvent.setup()
    const h = handlers()
    const old = section("old-1", "Mains (old)", "superseded")
    const target = section("new-1", "Mains", "confirmed")
    const photo = submission({
      id: "item-1",
      state: "accepted",
      requirement: { id: old.id, title: old.title },
    })
    render(
      <MenuCoveragePanel
        menu={menuView({
          menuState: "reconciliation_pending",
          currentPlan: {
            id: "plan-confirmed",
            status: "confirmed",
            menuVersionId: "eeeeeeee-0000-4000-8000-000000000002",
            revision: 1,
            reconciliationRequired: true,
            reconciledAt: null,
            confirmedAt: "2026-11-02T09:00:00.000Z",
            createdAt: "2026-11-02T08:00:00.000Z",
          },
          current: [target],
          superseded: [old],
        })}
        evidence={{ [old.id]: [photo] }}
        basePath="/staff/manage"
        handlers={h}
      />
    )
    expect(
      screen.getAllByText("Menu changed — review coverage").length
    ).toBeGreaterThan(0)
    expect(screen.getByText(/Nothing is matched by name/)).toBeTruthy()

    const card = screen.getByRole("heading", {
      name: "Previous section: Mains (old)",
    }).parentElement!.parentElement!
    // No target is pre-selected, even though the names are similar.
    await user.click(
      within(card).getByRole("button", { name: "Carry 1 photo" })
    )
    expect(within(card).getByText("Choose the new section.")).toBeTruthy()
    expect(within(card).getByText("Give a reason.")).toBeTruthy()
    expect(h.reconcile).not.toHaveBeenCalled()

    await user.type(within(card).getByLabelText("Reason"), "Section removed")
    await user.click(
      within(card).getByRole("button", { name: "Carry nothing and close it" })
    )
    expect(h.reconcile).toHaveBeenCalledWith({
      fromRequirementId: "old-1",
      toRequirementId: null,
      submissionIds: [],
      reason: "Section removed",
    })
  })
})

describe("manager pages never show account data", () => {
  it("roster people carry no email or account fields", () => {
    const keys = Object.keys(monthly().person).sort()
    expect(keys).toEqual([
      "active",
      "avatarUrl",
      "department",
      "displayName",
      "id",
      "jobTitle",
    ])
    expect(MANAGER_ID).not.toBe(STAFF_ID)
  })
})
