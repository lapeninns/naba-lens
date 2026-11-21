// @vitest-environment jsdom
// S2-MGR: the manager Overview's panels (spec §7 M1) and the Venue hub's
// controls (§7 M5, §9.3) in their states.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/manager",
  useRouter: () => ({ refresh }),
}))
vi.mock("@/app/manager/venue/actions", () => ({
  confirmMenuMonthAction: vi.fn(),
  setReviewerAction: vi.fn(),
  venueHistoryAction: vi.fn(),
}))

import {
  BacklogPanel,
  CategoryCoverage,
  OverviewActions,
  VenueAtAGlance,
} from "@/components/nabalens/manager/overview/overview-panels"
import { MenuMonthCheckControl } from "@/components/nabalens/manager/venue/menu-month-check"
import { ReviewersForm } from "@/components/nabalens/manager/venue/reviewers-form"
import { StillRightList } from "@/components/nabalens/manager/venue/still-right-list"
import { VenueHistoryList } from "@/components/nabalens/manager/venue/venue-history-list"
import type { OverviewAction } from "@/lib/manager/overview"
import type {
  ManagerVenueSummary,
  MenuMonthCheck,
  VenueReviewers,
} from "@/lib/manager/venue"

afterEach(() => {
  cleanup()
  refresh.mockClear()
})

const ACTIONS: OverviewAction[] = [
  {
    key: "review",
    title: "Review next",
    line: "50 photos waiting · oldest 3 days",
    href: "/manager/review",
    waiting: true,
  },
  {
    key: "venue",
    title: "Check venue details",
    line: "Facts confirmed",
    href: "/manager/venue",
    waiting: false,
  },
  {
    key: "request",
    title: "Request missing photos",
    line: "3 slots still empty",
    href: "/manager/requests",
    waiting: true,
  },
  {
    key: "outdated",
    title: "Resolve outdated public content",
    line: "2 publication issues",
    href: "/manager/exports",
    waiting: true,
  },
]

const CHECK: MenuMonthCheck = {
  month: "2026-11-01",
  menuVersionId: "m",
  menuTitle: "Autumn menu",
  due: true,
  confirmedAt: null,
  confirmedBy: null,
}

describe("Overview panels", () => {
  // Redesign R4 (the handoff's Overview): Needs you today.
  it("puts Review N photos as the one main button, then open jobs as links and finished ones with their chip", () => {
    render(
      <OverviewActions
        actions={ACTIONS}
        pendingPhotos={50}
        reviewHref="/manager/review"
        extra={[
          {
            key: "confirm",
            title: "Confirm amenity findings",
            line: "2 findings from staff to confirm",
            href: "/manager/amenities#amenities-to-confirm",
            waiting: true,
          },
        ]}
      />
    )
    const main = screen.getByRole("link", { name: "Review 50 photos" })
    expect(main.getAttribute("href")).toBe("/manager/review")
    // What is waiting is said under the button, not in a second Review row.
    expect(screen.getByText("50 photos waiting · oldest 3 days")).toBeTruthy()
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-action]")
    )
    expect(rows.map((r) => r.dataset.action)).toEqual([
      "request",
      "outdated",
      "confirm",
      "venue",
    ])
    expect(within(rows[1]!).getByRole("link").getAttribute("href")).toBe(
      "/manager/exports"
    )
    // A finished job stays, with its chip, and is not a link.
    expect(within(rows[3]!).queryByRole("link")).toBeNull()
    expect(rows[3]!.textContent).toContain("Complete")
    expect(rows[3]!.textContent).toContain("Facts confirmed")
  })

  it("draws no main button when nothing is waiting", () => {
    render(
      <OverviewActions actions={ACTIONS} pendingPhotos={0} reviewHref="/r" />
    )
    expect(document.querySelector('[data-slot="review-next"]')).toBeNull()
  })

  it("keeps the collection backlog apart from the review backlog, and says when it couldn't count", () => {
    render(
      <BacklogPanel
        split={{ toCollect: 0, slotsWaiting: 20, photosWaiting: 50 }}
      />
    )
    const collect = document.querySelector('[data-backlog="collect"]')!
    const review = document.querySelector('[data-backlog="review"]')!
    expect(collect.textContent).toContain("0")
    expect(review.textContent).toContain("50")
    expect(review.textContent).toContain("for 20 slots")
    cleanup()
    render(
      <BacklogPanel
        split={{ toCollect: null, slotsWaiting: null, photosWaiting: null }}
      />
    )
    expect(screen.getAllByText("We couldn't count these.")).toHaveLength(2)
  })

  it("shows each category as n of N with the percentage, and a failure in words", () => {
    render(
      <CategoryCoverage
        rows={[
          {
            key: "food",
            label: "Food",
            text: "3 of 4",
            percent: "75%",
            covered: 3,
            total: 4,
          },
        ]}
      />
    )
    const food = document.querySelector('[data-category="food"]')!
    expect(food.textContent).toContain("3 of 4")
    expect(food.textContent).toContain("75%")
    expect(
      within(food as HTMLElement).getByRole("progressbar", {
        name: "Food: 3 of 4, 75%",
      })
    ).toBeTruthy()
    cleanup()
    render(<CategoryCoverage rows={null} />)
    expect(screen.getByRole("status").textContent).toMatch(/couldn't/)
  })

  it("names the active menu and both reviewers, and offers to choose a missing backup", () => {
    const summary: ManagerVenueSummary = {
      venueId: "v",
      menuCheck: CHECK,
      unlabelledPhotos: 0,
      reviewers: {
        main: { profileId: "p1", name: "Maya Rai", since: null },
        backup: null,
      },
    }
    render(
      <VenueAtAGlance
        summary={summary}
        venueHref="/manager/venue"
        reviewersHref="/manager/venue#reviewers"
      />
    )
    expect(
      document.querySelector('[data-slot="active-menu"]')!.textContent
    ).toContain("Autumn menu")
    expect(document.querySelector('[data-reviewer="main"]')!.textContent).toBe(
      "Maya Rai"
    )
    expect(
      document.querySelector('[data-reviewer="backup"]')!.textContent
    ).toBe("Not chosen yet")
    expect(
      screen
        .getByRole("link", { name: "Choose a backup reviewer" })
        .getAttribute("href")
    ).toBe("/manager/venue#reviewers")
  })
})

describe("MenuMonthCheckControl", () => {
  it("asks for this month's check and says who confirmed it, in place", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn(async () => ({
      ok: true as const,
      check: { ...CHECK, due: false, confirmedBy: "Maya Rai" },
    }))
    render(<MenuMonthCheckControl check={CHECK} onConfirm={onConfirm} />)
    expect(
      screen.getByText(/November check: is the menu still right/)
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Still right" }))
    expect(onConfirm).toHaveBeenCalledWith({})
    expect(
      await screen.findByText("Confirmed for November by Maya Rai.")
    ).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })

  it("keeps the button and says what went wrong", async () => {
    const user = userEvent.setup()
    render(
      <MenuMonthCheckControl
        check={CHECK}
        onConfirm={async () => ({ ok: false, message: "No active menu." })}
      />
    )
    await user.click(screen.getByRole("button", { name: "Still right" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No active menu."
    )
    expect(screen.getByRole("button", { name: "Still right" })).toBeTruthy()
  })
})

describe("ReviewersForm", () => {
  const REVIEWERS: VenueReviewers = {
    venueId: "v",
    main: { profileId: "p1", name: "Maya Rai", since: null },
    backup: null,
    candidates: [
      { profileId: "p1", name: "Maya Rai" },
      { profileId: "p2", name: "Sam Okafor" },
    ],
  }

  it("nominates a backup from the venue's managers and says it saved", async () => {
    const user = userEvent.setup()
    const onSet = vi.fn(async () => ({
      ok: true as const,
      reviewers: {
        ...REVIEWERS,
        backup: { profileId: "p2", name: "Sam Okafor", since: null },
      },
    }))
    render(<ReviewersForm reviewers={REVIEWERS} onSet={onSet} />)
    await user.click(screen.getByRole("combobox", { name: /Backup reviewer/ }))
    await user.click(await screen.findByRole("option", { name: "Sam Okafor" }))
    await user.type(screen.getByLabelText(/Reason/), "Covers weekends")
    await user.click(
      screen.getByRole("button", { name: "Save backup reviewer" })
    )
    expect(onSet).toHaveBeenCalledTimes(1)
    expect(onSet).toHaveBeenCalledWith({
      role: "backup",
      profileId: "p2",
      reason: "Covers weekends",
    })
    expect(await screen.findByText("Backup reviewer saved.")).toBeTruthy()
  })

  // S3-R5 (V1): the main reviewer is the admin's (spec §8 A2).
  it("shows the main reviewer read-only and never offers them as backup", async () => {
    const user = userEvent.setup()
    const onSet = vi.fn()
    render(<ReviewersForm reviewers={REVIEWERS} onSet={onSet} />)
    expect(screen.queryByRole("combobox", { name: /Main reviewer/ })).toBeNull()
    expect(document.querySelector('[data-reviewer="main"]')!.textContent).toBe(
      "Maya Rai"
    )
    await user.click(screen.getByRole("combobox", { name: /Backup reviewer/ }))
    expect(
      await screen.findByRole("option", { name: "Sam Okafor" })
    ).toBeTruthy()
    expect(screen.queryByRole("option", { name: "Maya Rai" })).toBeNull()
    cleanup()
    render(
      <ReviewersForm
        reviewers={{ ...REVIEWERS, main: null, candidates: [] }}
        onSet={onSet}
      />
    )
    expect(
      document.querySelector('[data-reviewer="main"]')!.textContent
    ).toMatch(/Ask an admin to name the main reviewer/)
    expect(screen.getByRole("status").textContent).toMatch(
      /Nobody else here holds manager permission/
    )
    expect(onSet).not.toHaveBeenCalled()
  })

  it("says what went wrong when the database refuses", async () => {
    const user = userEvent.setup()
    const onSet = vi.fn(async () => ({
      ok: false as const,
      message: "Choose someone who is a manager at this venue.",
    }))
    render(<ReviewersForm reviewers={REVIEWERS} onSet={onSet} />)
    await user.click(screen.getByRole("combobox", { name: /Backup reviewer/ }))
    await user.click(await screen.findByRole("option", { name: "Sam Okafor" }))
    await user.click(
      screen.getByRole("button", { name: "Save backup reviewer" })
    )
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Choose someone who is a manager at this venue."
    )
  })
})

describe("StillRightList", () => {
  it("confirms an answer in place, and links an unanswered one to its question", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn(async () => ({ ok: true as const }))
    render(
      <StillRightList
        label="Facts"
        onConfirm={onConfirm}
        items={[
          {
            id: "fact:c1",
            title: "Is there step-free access?",
            lines: ["Check due · Answer: Yes"],
            payload: { checkId: "c1", slotRevision: 4 },
            href: "/c1",
          },
          {
            id: "fact:c2",
            title: "Are dogs allowed inside?",
            lines: ["Unconfirmed · No answer yet"],
            payload: null,
            href: "/c2",
          },
        ]}
      />
    )
    expect(
      screen.getByRole("link", { name: "Answer it" }).getAttribute("href")
    ).toBe("/c2")
    await user.click(
      screen.getByRole("button", {
        name: "Still right: Is there step-free access?",
      })
    )
    expect(onConfirm).toHaveBeenCalledWith({ checkId: "c1", slotRevision: 4 })
    expect(await screen.findByText("Confirmed as still right.")).toBeTruthy()
  })
})

describe("VenueHistoryList", () => {
  it("words each change with who and when, and loads older changes in place", async () => {
    const user = userEvent.setup()
    const loadMore = vi.fn(async () => ({
      ok: true as const,
      page: {
        venueId: "v",
        items: [
          {
            source: "activity",
            id: "1",
            at: "2026-11-01T10:00:00Z",
            actorName: null,
            actorRole: "system",
            action: "reviewer_ended",
            objectType: "venue_reviewer",
            objectId: null,
            reason: "No longer a manager at this venue",
          },
        ],
        nextCursor: null,
      },
    }))
    render(
      <VenueHistoryList
        items={[
          {
            source: "amenity_scope",
            id: "2",
            at: "2026-11-17T18:30:00Z",
            actorName: "Maya Rai",
            actorRole: "manager",
            action: "applicability_removed",
            objectType: "amenity_check",
            objectId: null,
            reason: "No darts board",
          },
        ]}
        nextCursor={{ at: "2026-11-17T18:30:00Z", source: "x", id: "2" }}
        loadMore={loadMore}
      />
    )
    const list = document.querySelector('[data-slot="venue-history"]')!
    expect(list.textContent).toContain("Marked not here")
    expect(list.textContent).toContain("by Maya Rai")
    expect(list.textContent).toContain("No darts board")
    await user.click(screen.getByRole("button", { name: "Show older changes" }))
    expect(await screen.findByText("Reviewer role ended")).toBeTruthy()
    expect(screen.getByText(/by the system/)).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Show older changes" })
    ).toBeNull()
  })
})
