// @vitest-environment jsdom
import {
  cleanup,
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
  TeamRoster,
  lastDayOfPeriod,
  targetReasonRequired,
  type MenuCoverageHandlers,
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

  it("shows names, teams and progress only, and needs-setup people as never complete", () => {
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
    const list = screen.getByRole("list", { name: "Team" })
    const rows = within(list).getAllByRole("listitem")
    expect(within(rows[0]).getByText("2 of 5 accepted")).toBeTruthy()
    expect(
      within(rows[0]).getByText("Front of house (FOH) · Bartender")
    ).toBeTruthy()
    expect(
      within(rows[1]).getByText(
        "Needs setup: no FOH/BOH team and no monthly target"
      )
    ).toBeTruthy()
    expect(within(rows[1]).queryByText("Complete")).toBeNull()
    expect(within(rows[1]).getByText(/No photo target set/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/@/)
    expect(
      within(rows[0])
        .getByRole("link", { name: /TEST Sam/ })
        .getAttribute("href")
    ).toBe(`/staff/manage/team?staff=${STAFF_ID}&period=2026-11`)
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
      screen.getByRole("button", { name: "Edit target for TEST Sam" })
    )
    const dialog = await screen.findByRole("dialog")
    const count = within(dialog).getByLabelText("Photos this month")
    await user.clear(count)
    await user.type(count, "6")
    await user.click(
      within(dialog).getByRole("button", { name: "Save target" })
    )
    expect(
      within(dialog).getByText("Give a reason for this change.")
    ).toBeTruthy()
    expect(onSetTarget).not.toHaveBeenCalled()
    await user.type(
      within(dialog).getByLabelText("Reason for the change"),
      "Extra shifts"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Save target" })
    )
    expect(onSetTarget).toHaveBeenCalledWith({
      staffId: STAFF_ID,
      period: "2026-11",
      targetCount: 6,
      dueOn: "2026-11-30",
      reason: "Extra shifts",
      expectedRevision: 2,
    })
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
    await user.click(
      screen.getByRole("button", { name: "Set target for TEST Sam" })
    )
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByLabelText("Reason for the change")).toBeNull()
    const due = within(dialog).getByLabelText("Due date")
    expect(due.getAttribute("min")).toBe("2026-11-01")
    expect(due.getAttribute("max")).toBe("2026-11-30")
    await user.type(within(dialog).getByLabelText("Photos this month"), "4")
    await user.click(
      within(dialog).getByRole("button", { name: "Save target" })
    )
    expect(onSetTarget).toHaveBeenCalledWith(
      expect.objectContaining({ targetCount: 4, reason: null })
    )
  })

  it("closes the target dialog on a conflict and moves focus to the page notice", async () => {
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
      screen.getByRole("button", { name: "Edit target for TEST Sam" })
    )
    const dialog = await screen.findByRole("dialog")
    const count = within(dialog).getByLabelText("Photos this month")
    await user.clear(count)
    await user.type(count, "6")
    await user.type(
      within(dialog).getByLabelText("Reason for the change"),
      "Extra shifts"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Save target" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(onStale).toHaveBeenCalledTimes(1)
    const notice = screen.getByRole("status")
    expect(notice.textContent).toMatch(/Someone else changed this a moment ago/)
    expect(screen.queryByRole("alert")).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(notice))
  })

  it("reopens the target dialog with the new saved values after a refresh", async () => {
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
    const edit = () =>
      screen.getByRole("button", { name: "Edit target for TEST Sam" })
    await user.click(edit())
    let dialog = await screen.findByRole("dialog")
    let count = within(dialog).getByLabelText("Photos this month")
    await user.clear(count)
    await user.type(count, "6")
    await user.type(
      within(dialog).getByLabelText("Reason for the change"),
      "Extra shifts"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Save target" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    // The re-read brings someone else's change as a new revision.
    rerender(
      <TeamRoster
        {...props}
        rows={[monthly({ targetCount: 8, revision: 3 })]}
      />
    )
    await user.click(edit())
    dialog = await screen.findByRole("dialog")
    count = within(dialog).getByLabelText("Photos this month")
    expect((count as HTMLInputElement).value).toBe("8")
    expect(
      (
        within(dialog).getByLabelText(
          "Reason for the change"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("")

    onSetTarget.mockResolvedValueOnce({ ok: true, revision: 4 })
    await user.clear(count)
    await user.type(count, "9")
    await user.type(
      within(dialog).getByLabelText("Reason for the change"),
      "Agreed with Sam"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Save target" })
    )
    expect(onSetTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetCount: 9, expectedRevision: 3 })
    )
  })

  it("keeps past months read-only for managers; admins correct them with a reason", () => {
    const past = {
      ...PERIOD,
      key: "2026-10",
      label: "October 2026",
      isCurrent: false,
    }
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
    expect(screen.getByText(/Only an admin can correct them/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /target/ })).toBeNull()
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
