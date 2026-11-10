// @vitest-environment jsdom
// Manager triage (B02 UI design §6.2, D6, F7): the Triage card, the To
// confirm badge on the venue tools and the Review page's Findings and All.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/manager/review",
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { ManageNav } from "@/components/nabalens/coverage"
import { TO_CONFIRM_COPY } from "@/components/nabalens/knowledge/copy"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { OverviewBody } from "@/components/nabalens/manager/overview/overview-body"
import {
  TRIAGE_COPY,
  TriageCard,
  triageConfirmCount,
} from "@/components/nabalens/manager/overview/triage-card"
import {
  AllView,
  FindingsView,
  findingWaitingAt,
  photoWaitingAt,
  REVIEW_KIND_COPY,
  ReviewKindFilter,
} from "@/components/nabalens/manager/review/triage-views"
import type { ToConfirmRow } from "@/lib/knowledge-client/contract"
import type {
  ManagerOverview,
  QueueCard,
} from "@/lib/server/menu-photos/types"
import type { TriageRow } from "@/lib/work-client/contract"
import { mergeByWaiting } from "@/lib/work-client/triage"

afterEach(cleanup)

const HREFS = {
  menu_photos: "/manager/review",
  findings: "/manager/amenities#amenities-to-confirm",
  checklist: "/staff/manage/review",
}

const ROWS: TriageRow[] = [
  {
    queue: "menu_photos",
    available: true,
    waiting: 4,
    oldestWaitingAt: "2026-11-03T09:30:00.000Z",
    ownWaiting: 2,
  },
  {
    queue: "findings",
    available: true,
    waiting: 3,
    oldestWaitingAt: "2026-11-02T14:05:00.000Z",
    ownWaiting: 0,
  },
  { queue: "checklist", available: false },
]

describe("Triage card", () => {
  it("shows one row per available queue, never a sum, and leaves an unavailable queue out", () => {
    render(<TriageCard rows={ROWS} hrefs={HREFS} />)
    const card = screen.getByRole("region", { name: TRIAGE_COPY.title })
    const links = within(card).getAllByRole("link")
    expect(links.map((l) => l.textContent)).toEqual([
      "Menu photos to review: 4, oldest 3 Nov 2026, 09:30",
      "Findings to confirm: 3, oldest 2 Nov 2026, 14:05",
    ])
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      HREFS.menu_photos,
      HREFS.findings,
    ])
    expect(within(card).queryByText(/7/)).toBeNull()
    expect(within(card).queryByText(/Checklist/)).toBeNull()
  })

  it("puts my own waiting photos on their own line, in today's words", () => {
    render(
      <TriageCard
        rows={ROWS}
        hrefs={HREFS}
        ownWaiting={(n) => ({
          text: MANAGER_COPY.overview.ownWaiting(n),
          href: "/manager/review?status=mine",
        })}
      />
    )
    const own = screen.getByRole("link", {
      name: MANAGER_COPY.overview.ownWaiting(2),
    })
    expect(own.getAttribute("href")).toBe("/manager/review?status=mine")
    // Never added into the queue's number.
    expect(
      screen.getByRole("link", { name: /^Menu photos to review: 4/ })
    ).toBeTruthy()
  })

  it("shows the checklist row when it is available (staff-held grant, admin)", () => {
    render(
      <TriageCard
        rows={[
          {
            queue: "checklist",
            available: true,
            waiting: 0,
            oldestWaitingAt: null,
            ownWaiting: 0,
          },
        ]}
        hrefs={HREFS}
      />
    )
    expect(
      screen
        .getByRole("link", { name: "Checklist photos to review: 0" })
        .getAttribute("href")
    ).toBe(HREFS.checklist)
  })

  it("counts To confirm from the findings queue only", () => {
    expect(triageConfirmCount(ROWS)).toBe(3)
    expect(triageConfirmCount([{ queue: "findings", available: false }])).toBe(
      null
    )
  })
})

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
    ownWaitingPhotos: 2,
    oldestPendingAt: "2026-11-04T12:00:00.000Z",
    carriedItems: 0,
    newItems: 0,
    sections: [],
    ...over,
  }
}

describe("manager Overview with triage on", () => {
  it("replaces the To confirm row and the own-photos tally with the card", () => {
    const { container } = render(
      <OverviewBody
        overview={overview()}
        now="2026-11-07T12:00:00.000Z"
        confirmCount={3}
        triage={<TriageCard rows={ROWS} hrefs={HREFS} />}
      />
    )
    expect(
      screen.getByRole("region", { name: TRIAGE_COPY.title })
    ).toBeTruthy()
    expect(container.querySelector('[data-tally="confirm"]')).toBeNull()
    expect(container.querySelector('[data-tally="own"]')).toBeNull()
    expect(
      screen.queryByRole("link", { name: TO_CONFIRM_COPY.overviewRow(3) })
    ).toBeNull()
  })

  it("off, keeps today's rows exactly", () => {
    const { container } = render(
      <OverviewBody
        overview={overview()}
        now="2026-11-07T12:00:00.000Z"
        confirmCount={3}
      />
    )
    expect(screen.queryByRole("region", { name: TRIAGE_COPY.title })).toBeNull()
    expect(container.querySelector('[data-tally="confirm"]')).toBeTruthy()
    expect(container.querySelector('[data-tally="own"]')).toBeTruthy()
  })
})

describe("venue tools To confirm badge (F7)", () => {
  it("badges Amenities with the count, in words, and nothing at zero", () => {
    render(
      <ManageNav basePath="/staff/manage" active="overview" confirmCount={3} />
    )
    const tab = screen.getByRole("link", { name: /Amenities/ })
    expect(tab.textContent).toContain("3")
    expect(tab.textContent).toContain(TO_CONFIRM_COPY.badge(3))
    cleanup()
    render(
      <ManageNav basePath="/staff/manage" active="overview" confirmCount={0} />
    )
    expect(screen.getByRole("link", { name: /Amenities/ }).textContent).not.toContain(
      TO_CONFIRM_COPY.badge(0)
    )
  })
})

function confirmRow(over: Partial<ToConfirmRow> = {}): ToConfirmRow {
  return {
    checkId: "c1",
    question: "Is there parking on site?",
    kind: "finding",
    sender: { id: "", displayName: "Sam Lee" },
    sentAt: "2026-11-05T10:00:00.000Z",
    answer: "no",
    conflict: false,
    disputes: false,
    slotRevision: 4,
    waitingSince: "2026-11-05T10:00:00.000Z",
    ...over,
  }
}

const PENDING = confirmRow()
// Its answer was sent before PENDING, but withdrawn after it (R4).
const WITHDRAWN = confirmRow({
  checkId: "c2",
  question: "Is there step-free access?",
  kind: "evidence_removed",
  sender: null,
  sentAt: "2026-11-01T09:00:00.000Z",
  waitingSince: "2026-11-06T09:00:00.000Z",
  disputes: true,
})

describe("Review: kind filter", () => {
  it("marks the current kind; Photos is the default URL", () => {
    render(<ReviewKindFilter active="findings" />)
    const nav = screen.getByRole("navigation", { name: REVIEW_KIND_COPY.label })
    const links = within(nav).getAllByRole("link")
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Photos", "/manager/review"],
      ["Findings", "/manager/review?kind=findings"],
      ["All", "/manager/review?kind=all"],
    ])
    expect(links[1].getAttribute("aria-current")).toBe("page")
    expect(links[0].getAttribute("aria-current")).toBeNull()
  })
})

describe("Review: Findings", () => {
  it("shows To confirm rows in the server's order: a withdrawal after a later-sent finding sorts after it", () => {
    render(<FindingsView rows={[PENDING, WITHDRAWN]} />)
    const links = within(
      screen.getByRole("list", { name: "Findings" })
    ).getAllByRole("link")
    expect(links[0].textContent).toContain(PENDING.question)
    expect(links[1].textContent).toContain(WITHDRAWN.question)
    expect(links[1].textContent).toContain(REVIEW_KIND_COPY.disputes)
    expect(links[1].textContent).toContain("Waiting since 6 Nov 2026, 09:00")
    expect(links[0].getAttribute("href")).toBe(
      "/manager/amenities/c1#amenity-to-confirm"
    )
  })

  it("says nothing waits when nothing does", () => {
    render(<FindingsView rows={[]} />)
    expect(screen.getByText(TO_CONFIRM_COPY.empty)).toBeTruthy()
  })
})

function card(over: Partial<QueueCard> = {}): QueueCard {
  return {
    key: "k1",
    kind: "labelled",
    labelId: "l1",
    photoId: null,
    asset: {} as QueueCard["asset"],
    uploadedAt: "2026-11-01T08:00:00.000Z",
    labelledAt: "2026-11-04T08:00:00.000Z",
    contributor: {
      id: "u1",
      name: "Ana Diaz",
      status: "here",
      canFollowUp: true,
    },
    isSelf: false,
    item: {
      itemId: "i1",
      name: "Fish pie",
      sectionId: "s1",
      sectionName: "Mains",
      variantId: null,
      variantName: null,
      covered: false,
    },
    staffLabels: [],
    state: null,
    isPrimary: false,
    isEffectivePrimary: false,
    basis: null,
    reason: null,
    recheckKind: null,
    correctsItemId: null,
    correctsVariantId: null,
    correctsItemName: null,
    itemRevision: 1,
    ...over,
  } as QueueCard
}

describe("Review: All", () => {
  it("merges by waiting time; each row keeps its own chip and links to its own screen", () => {
    const merged = mergeByWaiting(
      [card()],
      photoWaitingAt,
      [PENDING, WITHDRAWN],
      findingWaitingAt,
      false
    )
    render(<AllView entries={merged.entries} heldBack={merged.heldBack} />)
    const items = within(screen.getByRole("list", { name: "All" })).getAllByRole(
      "listitem"
    )
    expect(items.map((i) => i.getAttribute("data-entry"))).toEqual([
      "photo",
      "finding",
      "finding",
    ])
    const photoLink = within(items[0]).getByRole("link")
    expect(photoLink.getAttribute("href")).toBe("/manager/review?item=i1")
    expect(photoLink.textContent).toContain("Fish pie")
    // Review age counts from labelling (MG-28).
    expect(photoLink.textContent).toContain("Waiting since 4 Nov 2026, 08:00")
    expect(within(items[1]).getByText("Awaiting confirmation")).toBeTruthy()
  })

  it("points to Photos when photos it couldn't show are waiting", () => {
    render(<AllView entries={[]} heldBack={2} />)
    expect(
      screen
        .getByRole("link", { name: REVIEW_KIND_COPY.heldBack })
        .getAttribute("href")
    ).toBe("/manager/review")
  })
})
