// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { OverviewBody } from "@/components/nabalens/manager/overview/overview-body"
import { TeamCompletionTargets } from "@/components/nabalens/manager/overview/team-completion-targets"
import type { ManagerOverview } from "@/lib/server/menu-photos/types"

import { monthly } from "./coverage-fixtures"

afterEach(() => cleanup())

const NOW = "2026-11-07T12:00:00.000Z"
const STARTERS = "00000000-0000-4000-8000-0000000000b1"
const MAINS = "00000000-0000-4000-8000-0000000000b2"

function overview(over: Partial<ManagerOverview> = {}): ManagerOverview {
  return {
    venueId: "00000000-0000-4000-8000-0000000000a1",
    venueName: "The Railway",
    menuState: "ready",
    menu: {
      versionId: "00000000-0000-4000-8000-0000000000d1",
      title: "Autumn menu",
      activatedAt: "2026-09-01T09:00:00.000Z",
    },
    eligible: 10,
    covered: 4,
    awaitingReviewItems: 3,
    needsPhotoItems: 3,
    replacementPendingItems: 0,
    needsRecheckItems: 0,
    pendingPhotos: 5,
    ownWaitingPhotos: 0,
    oldestPendingAt: "2026-11-04T12:00:00.000Z",
    carriedItems: 0,
    newItems: 0,
    sections: [
      {
        sectionId: STARTERS,
        name: "Starters",
        kind: "food",
        position: 1,
        eligible: 4,
        covered: 2,
        awaitingReview: 1,
        needsPhoto: 1,
      },
      {
        sectionId: MAINS,
        name: "Mains",
        kind: "food",
        position: 2,
        eligible: 6,
        covered: 2,
        awaitingReview: 2,
        needsPhoto: 2,
      },
    ],
    ...over,
  }
}

const show = (o: ManagerOverview) =>
  render(<OverviewBody overview={o} now={NOW} />)

const hrefOf = (name: string | RegExp) =>
  screen.getByRole("link", { name }).getAttribute("href")

describe("Overview", () => {
  it("no_menu: the setup-pending note and no action", () => {
    show(overview({ menuState: "no_menu", menu: null, eligible: 0 }))
    expect(screen.getByText(MANAGER_COPY.overview.noMenuTitle)).toBeTruthy()
    expect(screen.getByText(MANAGER_COPY.overview.noMenuBody)).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByRole("progressbar")).toBeNull()
  })

  it("empty: names the menu and its activation date", () => {
    show(overview({ menuState: "empty", eligible: 0, covered: 0 }))
    expect(screen.getByText(MANAGER_COPY.overview.emptyTitle)).toBeTruthy()
    expect(
      screen.getByText("Autumn menu · active since 1 Sept 2026")
    ).toBeTruthy()
    expect(screen.getByText("Ask an admin to check the menu.")).toBeTruthy()
  })

  it("ready with a queue: heading, meter, linked tallies and Review photos", () => {
    show(overview())
    const heading = "Menu photos · 4 of 10 items covered"
    expect(
      screen.getByRole("heading", { level: 2, name: heading })
    ).toBeTruthy()
    const bar = screen.getByRole("progressbar")
    expect(bar.getAttribute("aria-valuetext")).toBe(heading)
    expect(bar.getAttribute("aria-valuenow")).toBe("40")
    expect(hrefOf("5 photos waiting for a decision")).toBe("/manager/review")
    expect(hrefOf("3 items awaiting review")).toBe(
      "/manager/menu?status=awaiting_review"
    )
    expect(hrefOf("3 items with no ready photo")).toBe(
      "/manager/menu?status=needs_photo"
    )
    expect(hrefOf("Oldest waiting: 3 days")).toBe("/manager/review")
    expect(hrefOf("Review photos")).toBe("/manager/review")
    expect(hrefOf("Starters: 2 of 4")).toBe(`/manager/menu?section=${STARTERS}`)
    expect(hrefOf("Mains: 2 of 6")).toBe(`/manager/menu?section=${MAINS}`)
    // Lines with nothing behind them are left out.
    expect(screen.queryByText(/new photo waiting/)).toBeNull()
    expect(screen.queryByText(/new decision/)).toBeNull()
    expect(screen.queryByText(/earlier photos/)).toBeNull()
  })

  it("uses the singular for one of each", () => {
    show(
      overview({
        pendingPhotos: 1,
        awaitingReviewItems: 1,
        needsPhotoItems: 1,
        replacementPendingItems: 1,
        needsRecheckItems: 1,
        ownWaitingPhotos: 1,
        eligible: 1,
        covered: 0,
      })
    )
    expect(screen.getByText("Menu photos · 0 of 1 item covered")).toBeTruthy()
    expect(hrefOf("1 photo waiting for a decision")).toBe("/manager/review")
    expect(screen.getByText("1 item awaiting review")).toBeTruthy()
    expect(screen.getByText("1 item with no ready photo")).toBeTruthy()
    expect(hrefOf("1 item has a new photo waiting")).toBe(
      "/manager/menu?status=replacement"
    )
    expect(
      hrefOf("1 item needs a new decision after a menu or label change")
    ).toBe("/manager/review?status=recheck")
    expect(hrefOf("1 of your earlier photos is waiting for an admin")).toBe(
      "/manager/review?status=mine"
    )
  })

  it("own waiting line links to Your photos", () => {
    show(overview({ ownWaitingPhotos: 2 }))
    expect(hrefOf("2 of your earlier photos are waiting for an admin")).toBe(
      "/manager/review?status=mine"
    )
  })

  it("quiet queue: no Review button, the gap count and a link to the gaps", () => {
    show(overview({ pendingPhotos: 0, oldestPendingAt: null }))
    expect(screen.queryByRole("link", { name: "Review photos" })).toBeNull()
    expect(screen.queryByText(/Oldest waiting/)).toBeNull()
    expect(screen.getByText(MANAGER_COPY.overview.quietTitle)).toBeTruthy()
    expect(
      screen.getByText(
        "6 items still need a photo. Staff see these gaps in Our menu."
      )
    ).toBeTruthy()
    expect(hrefOf("See items without a photo")).toBe(
      "/manager/menu?status=needs_photo"
    )
  })

  it("all covered: the done line and Review newer photos", () => {
    show(
      overview({
        covered: 10,
        awaitingReviewItems: 0,
        needsPhotoItems: 0,
        pendingPhotos: 0,
        oldestPendingAt: null,
      })
    )
    expect(screen.queryByRole("link", { name: "Review photos" })).toBeNull()
    expect(screen.getByText("Every menu item has a photo")).toBeTruthy()
    expect(hrefOf("Review newer photos")).toBe("/manager/review?status=pending")
  })

  it("activation banner within 14 days of a menu change", () => {
    show(
      overview({
        menu: {
          versionId: "00000000-0000-4000-8000-0000000000d2",
          title: "Winter menu",
          activatedAt: "2026-11-01T09:00:00.000Z",
        },
        carriedItems: 3,
        needsRecheckItems: 1,
        newItems: 1,
      })
    )
    const banner = document.querySelector(
      '[data-slot="activation-banner"]'
    ) as HTMLElement
    expect(banner).toBeTruthy()
    expect(banner.textContent).toContain(
      "Menu active since 1 Nov 2026: 3 items kept their photo, 1 need a new decision, 1 new item."
    )
    expect(
      within(banner)
        .getByRole("link", { name: "Review changes" })
        .getAttribute("href")
    ).toBe("/manager/review?status=recheck")
  })

  it("no activation banner after 14 days or with nothing changed", () => {
    show(overview({ carriedItems: 3, needsRecheckItems: 1 }))
    expect(document.querySelector('[data-slot="activation-banner"]')).toBeNull()
    cleanup()
    show(
      overview({
        menu: {
          versionId: "00000000-0000-4000-8000-0000000000d2",
          title: "Winter menu",
          activatedAt: "2026-11-01T09:00:00.000Z",
        },
      })
    )
    expect(document.querySelector('[data-slot="activation-banner"]')).toBeNull()
  })
})

describe("Team completion targets", () => {
  it("shows the staff member's breakdown and completed target", () => {
    const target = monthly({
      targetCount: 5,
      accepted: 0,
      complete: true,
      completionProgress: { total: 5, menuItems: 3, amenityChecks: 2 },
    })
    render(<TeamCompletionTargets roster={[target]} />)
    const section = screen.getByRole("region", {
      name: "Staff targets for November 2026",
    })
    expect(within(section).getByText(target.person.displayName)).toBeTruthy()
    expect(within(section).getByText("5 of 5 completed")).toBeTruthy()
    expect(
      within(section).getByText("3 menu items · 2 amenity checks")
    ).toBeTruthy()
    expect(within(section).getByText("Target met")).toBeTruthy()
  })
})
