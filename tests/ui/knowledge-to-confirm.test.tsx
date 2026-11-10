// @vitest-environment jsdom
// To confirm outside the check page (B01-04, rev 5 §6.1): the Amenities
// overview group and tally, the Amenities tab badge and the Overview row.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/manager",
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { AmenitiesOverview } from "@/components/nabalens/amenities/manage"
import { ManagerShell } from "@/components/nabalens/manager/manager-shell"
import type {
  ToConfirmList,
  ToConfirmRow,
} from "@/lib/knowledge-client/contract"

import { DARTS, STEP_FREE_CHECK, view } from "./amenities-manage-fixtures"

afterEach(cleanup)

function row(over: Partial<ToConfirmRow> = {}): ToConfirmRow {
  return {
    checkId: DARTS.id,
    question: DARTS.entry.question,
    kind: "finding",
    sender: { id: "", displayName: "Sam Lee" },
    sentAt: "2026-11-05T10:00:00.000Z",
    answer: "no",
    conflict: false,
    disputes: false,
    slotRevision: 4,
    ...over,
  }
}

function overview(toConfirm: ToConfirmList | null, toConfirmFailed = false) {
  return render(
    <AmenitiesOverview
      view={view()}
      catalogue={[]}
      basePath="/manager"
      handlers={{ enable: vi.fn(), addChecks: vi.fn(), restore: vi.fn() }}
      toConfirm={toConfirm}
      toConfirmFailed={toConfirmFailed}
    />
  )
}

describe("Amenities overview: To confirm", () => {
  it("lists one row per question first, with what waits and a link to decide", () => {
    overview({
      count: 4,
      items: [
        row(),
        row({
          checkId: STEP_FREE_CHECK.id,
          question: STEP_FREE_CHECK.entry.question,
          conflict: true,
          disputes: true,
        }),
        row({
          checkId: STEP_FREE_CHECK.id,
          question: STEP_FREE_CHECK.entry.question,
          conflict: true,
          sender: { id: "", displayName: "Ana Gurung" },
        }),
        row({
          checkId: "c-wifi",
          question: "Is there guest Wi-Fi?",
          kind: "answer_unconfirmed",
          sender: null,
          sentAt: null,
          answer: "yes",
        }),
      ],
    })
    const sections = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent)
    expect(sections[0]).toMatch(/^To confirm/)
    const group = document.getElementById("amenities-to-confirm")!
    const links = within(group).getAllByRole("link")
    expect(links).toHaveLength(3)
    expect(links[0].getAttribute("href")).toBe(
      `/manager/amenities/${DARTS.id}#amenity-to-confirm`
    )
    expect(links[0].textContent).toContain("Finding from Sam Lee")
    expect(links[0].textContent).toContain("Answer: No · Sent 5 Nov")
    expect(links[1].textContent).toContain("2 findings disagree")
    expect(links[1].textContent).toContain(
      "Readers are told it's being checked."
    )
    expect(links[2].textContent).toContain("Answer in use, not confirmed")
    const tally = screen.getByRole("link", { name: /To confirm/ })
    expect(tally.getAttribute("href")).toBe("#amenities-to-confirm")
  })

  it("shows nothing for To confirm when nothing waits", () => {
    overview({ count: 0, items: [] })
    expect(document.getElementById("amenities-to-confirm")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says the findings couldn't be loaded, never that nothing waits (MG-03)", () => {
    overview(null, true)
    expect(screen.getByRole("alert").textContent).toBe(
      "Findings to confirm couldn't be loaded. Reload to try again."
    )
  })
})

describe("To confirm order (B02 R4)", () => {
  it("keeps the server's waiting order: a withdrawal after a later-sent finding sorts after it", () => {
    // Its answer was sent first, but its evidence was withdrawn after the
    // pending finding was sent; the server orders by waitingSince.
    const pending = row({
      sentAt: "2026-11-05T10:00:00.000Z",
      waitingSince: "2026-11-05T10:00:00.000Z",
    })
    const withdrawn = row({
      checkId: STEP_FREE_CHECK.id,
      question: STEP_FREE_CHECK.entry.question,
      kind: "evidence_removed",
      sender: null,
      sentAt: "2026-11-01T09:00:00.000Z",
      waitingSince: "2026-11-06T09:00:00.000Z",
    })
    overview({ count: 2, items: [pending, withdrawn] })
    const group = screen.getByRole("region", { name: /To confirm/ })
    const links = within(group).getAllByRole("link")
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining(DARTS.entry.question),
      expect.stringContaining(STEP_FREE_CHECK.entry.question),
    ])
  })
})

describe("manager workspace: findings to confirm", () => {
  it("badges the Amenities tab with the count, in words", () => {
    render(
      <ManagerShell
        venueName="The Old Crown"
        userName="Maya Rai"
        confirmCount={3}
      >
        <p>content</p>
      </ManagerShell>
    )
    for (const nav of screen.getAllByRole("navigation", {
      name: "Venue workspace",
    })) {
      const amenities = within(nav)
        .getAllByRole("link")
        .find((a) => a.getAttribute("href") === "/manager/amenities")!
      expect(amenities.textContent).toContain("3")
      expect(
        within(amenities).getByText(/3/).closest("[data-slot]") ?? amenities
      ).toBeTruthy()
      expect(amenities.textContent).toMatch(/findings to confirm/)
    }
  })

  it("leaves the Amenities tab without a badge at zero", () => {
    render(
      <ManagerShell
        venueName="The Old Crown"
        userName="Maya Rai"
        confirmCount={0}
      >
        <p>content</p>
      </ManagerShell>
    )
    expect(document.body.textContent).not.toMatch(/to confirm/)
  })
})

describe("manager Overview: findings to confirm", () => {
  it("links the count to the Amenities To confirm group, in every menu state, and hides it at zero", async () => {
    const { OverviewBody } =
      await import("@/components/nabalens/manager/overview/overview-body")
    const base = {
      venueName: "The Old Crown",
      menuState: "no_menu",
      menu: null,
      eligible: 0,
      covered: 0,
      pendingPhotos: 0,
      oldestPendingAt: null,
      awaitingReviewItems: 0,
      needsPhotoItems: 0,
      replacementPendingItems: 0,
      needsRecheckItems: 0,
      ownWaitingPhotos: 0,
      sections: [],
    } as unknown as Parameters<typeof OverviewBody>[0]["overview"]
    render(
      <OverviewBody
        overview={base}
        now="2026-11-09T12:00:00.000Z"
        confirmCount={2}
      />
    )
    const link = screen.getByRole("link", { name: /2 findings to confirm/ })
    expect(link.getAttribute("href")).toBe(
      "/manager/amenities#amenities-to-confirm"
    )
    cleanup()
    render(
      <OverviewBody
        overview={base}
        now="2026-11-09T12:00:00.000Z"
        confirmCount={0}
      />
    )
    expect(screen.queryByText(/to confirm/)).toBeNull()
    cleanup()
    // A failed read is unknown, never zero (MG-03).
    render(
      <OverviewBody
        overview={base}
        now="2026-11-09T12:00:00.000Z"
        confirmCount={null}
      />
    )
    expect(screen.getByRole("alert").textContent).toBe(
      "Findings to confirm couldn't be loaded. Reload to try again."
    )
  })
})
